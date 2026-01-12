# 🧪 EDGE CASES VALIDATION TESTS

**Purpose**: Validate all 4 edge case action types are working end-to-end  
**Date**: November 27, 2025  
**Status**: Ready to Execute

---

## 📋 TEST OVERVIEW

This document provides **step-by-step validation tests** for the 4 edge case action types:

1. **Override Response** (Legacy + Enterprise) ✅
2. **Force Transfer** (Enterprise) 🆕
3. **Polite Hangup** (Enterprise) 🆕
4. **Flag Only** (Enterprise) 🆕

Each test includes:
- Edge case configuration to create in UI
- Test phrase to speak to agent
- Expected logs (with exact field names)
- Expected call behavior

---

## 🎯 TEST 1: OVERRIDE RESPONSE (Backward Compatible)

### Purpose
Verify that legacy edge cases still work AND new enterprise format works for response override.

### Test 1A: Legacy Format

**Create Edge Case in UI** (`control-plane-v2.html` → Edge Cases tab):
```json
{
  "name": "Test Override Legacy",
  "priority": 1,
  "enabled": true,
  "triggerPatterns": ["edge case test legacy"],
  "responseText": "LEGACY EDGE CASE TEST OVERRIDE"
}
```

**Test Phrase**: `"edge case test legacy"`

**Expected Logs**:

1. `[AGENT-INPUT]` (routes/v2twilio.js):
```json
{
  "companyId": "...",
  "callSid": "CA...",
  "speechResult": "edge case test legacy",
  "confidence": "0.95"
}
```

2. `[CHEAT SHEET ENGINE] Edge case triggered` (services/CheatSheetEngine.js):
```json
{
  "companyId": "...",
  "callId": "CA...",
  "edgeCase": {
    "id": "...",
    "name": "Test Override Legacy",
    "priority": 1,
    "actionType": "override_response",
    "matchedPattern": "edge case test legacy"
  },
  "sideEffects": {
    "autoBlacklist": false,
    "tags": [],
    "notifyContacts": [],
    "logSeverity": "info"
  },
  "shortCircuit": true,
  "timeMs": 5
}
```

3. `[CHEATSHEET]` (services/CallFlowExecutor.js):
```json
{
  "companyId": "...",
  "callSid": "CA...",
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "...",
      "actionType": "override_response"
    }
  ],
  "finalAction": "respond",
  "shortCircuit": true
}
```

4. `[AGENT-OUTPUT]` (routes/v2twilio.js):
```json
{
  "companyId": "...",
  "callSid": "CA...",
  "finalAction": "respond",
  "shortResponsePreview": "LEGACY EDGE CASE TEST OVERRIDE",
  "willTransfer": false,
  "willHangup": false
}
```

**Expected Call Behavior**:
- Agent speaks: "LEGACY EDGE CASE TEST OVERRIDE"
- Call continues with `<Gather>` for next input
- No transfer, no hangup

**✅ Pass Criteria**:
- All 4 logs present with correct fields
- `actionType: "override_response"`
- `shortCircuit: true`
- TwiML contains override text
- Call continues normally

---

### Test 1B: Enterprise Format (Same Behavior, New Schema)

**Create Edge Case in UI**:
```json
{
  "id": "ec-test-override-001",
  "name": "Test Override Enterprise",
  "description": "Tests enterprise override response format",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["edge case test enterprise"]
  },
  "action": {
    "type": "override_response",
    "inlineResponse": "ENTERPRISE EDGE CASE TEST OVERRIDE"
  },
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["test", "override"],
    "notifyContacts": [],
    "logSeverity": "info"
  }
}
```

**Test Phrase**: `"edge case test enterprise"`

**Expected Logs**: Same as Test 1A, but:
- `edgeCase.name`: "Test Override Enterprise"
- `sideEffects.tags`: `["test", "override"]`
- `shortResponsePreview`: "ENTERPRISE EDGE CASE TEST OVERRIDE"

**✅ Pass Criteria**: Same as Test 1A

---

## 🎯 TEST 2: FORCE TRANSFER (Enterprise)

### Purpose
Verify that edge cases can force a transfer with a custom message.

**Create Edge Case in UI**:
```json
{
  "id": "ec-test-transfer-001",
  "name": "Test Force Transfer",
  "description": "Tests forced transfer to manager",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["transfer test"]
  },
  "action": {
    "type": "force_transfer",
    "transferTarget": "manager",
    "transferMessage": "Let me connect you to our manager for testing purposes."
  },
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["test", "transfer"],
    "notifyContacts": [],
    "logSeverity": "info"
  }
}
```

**Test Phrase**: `"transfer test"`

**Expected Logs**:

1. `[AGENT-INPUT]`:
```json
{
  "speechResult": "transfer test",
  "confidence": "0.95"
}
```

2. `[CHEAT SHEET ENGINE] Edge case triggered`:
```json
{
  "edgeCase": {
    "id": "ec-test-transfer-001",
    "name": "Test Force Transfer",
    "priority": 1,
    "actionType": "force_transfer",
    "matchedPattern": "transfer test"
  },
  "sideEffects": {
    "autoBlacklist": false,
    "tags": ["test", "transfer"],
    "notifyContacts": [],
    "logSeverity": "info"
  },
  "shortCircuit": true
}
```

3. `[CHEAT SHEET ENGINE] Edge case forcing transfer`:
```json
{
  "companyId": "...",
  "callId": "CA...",
  "transferTarget": "manager"
}
```

4. `[CHEATSHEET]`:
```json
{
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "ec-test-transfer-001",
      "actionType": "force_transfer"
    }
  ],
  "finalAction": "transfer",
  "shortCircuit": true
}
```

5. `[AGENT-OUTPUT]`:
```json
{
  "finalAction": "transfer",
  "shortResponsePreview": "Let me connect you to our manager for testing purposes.",
  "willTransfer": true,
  "willHangup": false
}
```

**Expected Call Behavior**:
- Agent speaks: "Let me connect you to our manager for testing purposes." (via ElevenLabs)
- TwiML contains `<Dial>` with manager's phone number
- Call transfers to manager contact
- NO `<Gather>` (call ends after transfer attempt)

**✅ Pass Criteria**:
- `actionType: "force_transfer"`
- `finalAction: "transfer"`
- `willTransfer: true`
- `transferTarget: "manager"`
- TwiML contains `<Dial>` element
- ElevenLabs audio plays before transfer

---

## 🎯 TEST 3: POLITE HANGUP (Enterprise)

### Purpose
Verify that edge cases can hang up with a custom message and trigger auto-blacklist.

**Create Edge Case in UI**:
```json
{
  "id": "ec-test-hangup-001",
  "name": "Test Polite Hangup",
  "description": "Tests polite hangup with auto-blacklist",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["hangup test"]
  },
  "action": {
    "type": "polite_hangup",
    "hangupMessage": "Thank you for calling. This test call is now ending. Goodbye."
  },
  "sideEffects": {
    "autoBlacklist": true,
    "autoTag": ["test", "hangup", "terminated"],
    "notifyContacts": [],
    "logSeverity": "critical"
  }
}
```

**Test Phrase**: `"hangup test"`

**Expected Logs**:

1. `[AGENT-INPUT]`:
```json
{
  "speechResult": "hangup test",
  "confidence": "0.95"
}
```

2. `[CHEAT SHEET ENGINE] Edge case triggered`:
```json
{
  "edgeCase": {
    "id": "ec-test-hangup-001",
    "name": "Test Polite Hangup",
    "priority": 1,
    "actionType": "polite_hangup",
    "matchedPattern": "hangup test"
  },
  "sideEffects": {
    "autoBlacklist": true,
    "tags": ["test", "hangup", "terminated"],
    "notifyContacts": [],
    "logSeverity": "critical"
  },
  "shortCircuit": true
}
```

3. `[CHEAT SHEET ENGINE] 🤖 Triggering auto-blacklist (side effect)`:
```json
{
  "companyId": "...",
  "callerPhone": "+1234567890",
  "edgeCaseId": "ec-test-hangup-001",
  "edgeCaseName": "Test Polite Hangup"
}
```

4. `[CHEAT SHEET ENGINE] Edge case forcing hangup`:
```json
{
  "companyId": "...",
  "callId": "CA...",
  "hangupMessage": "Thank you for calling. This test call is now ending. Goodbye."
}
```

5. `[CHEATSHEET]`:
```json
{
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "ec-test-hangup-001",
      "actionType": "polite_hangup"
    }
  ],
  "finalAction": "hangup",
  "shortCircuit": true
}
```

6. `[AGENT-OUTPUT]`:
```json
{
  "finalAction": "hangup",
  "shortResponsePreview": "Thank you for calling. This test call is now ending. Goodbye.",
  "willTransfer": false,
  "willHangup": true
}
```

7. `[CHEAT SHEET ENGINE] 🎉 Auto-blacklist SUCCESS` (async, may appear after hangup):
```json
{
  "companyId": "...",
  "phoneNumber": "+1234567890",
  "edgeCaseName": "Test Polite Hangup",
  "status": "active",
  "message": "Caller added to blacklist"
}
```

**Expected Call Behavior**:
- Agent speaks: "Thank you for calling. This test call is now ending. Goodbye." (via ElevenLabs)
- TwiML contains `<Hangup>` element
- Call terminates immediately
- NO `<Gather>` or `<Dial>`
- Caller's number added to company blacklist (check `callFiltering.blacklist` in MongoDB)

**✅ Pass Criteria**:
- `actionType: "polite_hangup"`
- `finalAction: "hangup"`
- `willHangup: true`
- `sideEffects.autoBlacklist: true`
- TwiML contains `<Hangup>` element
- Auto-blacklist log shows success
- Caller's number in company blacklist after call

**⚠️ CLEANUP**: Remove test number from blacklist after test:
```bash
# Via UI: Company Profile → Spam Filter → Blacklist → Remove
# Or via MongoDB:
db.v2companies.updateOne(
  { _id: ObjectId("...") },
  { $pull: { "callFiltering.blacklist": { number: "+1234567890" } } }
)
```

---

## 🎯 TEST 4: FLAG ONLY (Enterprise)

### Purpose
Verify that edge cases can log and tag calls WITHOUT changing behavior (no short-circuit).

**Create Edge Case in UI**:
```json
{
  "id": "ec-test-flag-only-001",
  "name": "Test Flag Only",
  "description": "Tests flag-only mode (logs without changing behavior)",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["flag test"]
  },
  "action": {
    "type": "flag_only"
  },
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["test", "flag_only", "monitoring"],
    "notifyContacts": [],
    "logSeverity": "warning"
  }
}
```

**Test Phrase**: `"flag test can you book an appointment"`

**Expected Logs**:

1. `[AGENT-INPUT]`:
```json
{
  "speechResult": "flag test can you book an appointment",
  "confidence": "0.95"
}
```

2. `[CHEAT SHEET ENGINE] Edge case triggered`:
```json
{
  "edgeCase": {
    "id": "ec-test-flag-only-001",
    "name": "Test Flag Only",
    "priority": 1,
    "actionType": "flag_only",
    "matchedPattern": "flag test"
  },
  "sideEffects": {
    "autoBlacklist": false,
    "tags": ["test", "flag_only", "monitoring"],
    "notifyContacts": [],
    "logSeverity": "warning"
  },
  "shortCircuit": false
}
```

3. `[CHEAT SHEET ENGINE] Edge case flag-only mode: continuing to other rules`:
```json
{
  "companyId": "...",
  "callId": "CA...",
  "edgeCaseId": "ec-test-flag-only-001"
}
```

4. `[3TIER]` (should fire because no short-circuit):
```json
{
  "companyId": "...",
  "callSid": "CA...",
  "tierUsed": "TIER_1",
  "scenarioId": "...",
  "scenarioCategory": "appointment",
  "confidence": 0.95
}
```

5. `[CHEATSHEET]`:
```json
{
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "ec-test-flag-only-001",
      "actionType": "flag_only"
    }
  ],
  "finalAction": "respond",
  "shortCircuit": false
}
```

6. `[AGENT-OUTPUT]`:
```json
{
  "finalAction": "respond",
  "shortResponsePreview": "I'd be happy to help you book an appointment! ...",
  "willTransfer": false,
  "willHangup": false
}
```

**Expected Call Behavior**:
- Edge case logs the match (flag captured)
- 3-Tier routing STILL RUNS (no short-circuit)
- Agent responds with normal appointment booking flow
- Call continues normally with `<Gather>`
- NO override, NO transfer, NO hangup

**✅ Pass Criteria**:
- `actionType: "flag_only"`
- `shortCircuit: false`
- `[3TIER]` log appears (proves no short-circuit)
- Agent responds with scenario-matched text (NOT edge case text)
- Call continues normally
- Edge case logged in `appliedBlocks[]`

---

## 📊 COMBINED TEST MATRIX

| Test | Action Type | Short-Circuit? | Final Action | TwiML Element | Side Effects |
|------|-------------|----------------|--------------|---------------|--------------|
| 1A | override_response (legacy) | ✅ Yes | respond | `<Say>` + `<Gather>` | None |
| 1B | override_response (enterprise) | ✅ Yes | respond | `<Say>` + `<Gather>` | autoTag |
| 2 | force_transfer | ✅ Yes | transfer | `<Say>` + `<Dial>` | autoTag |
| 3 | polite_hangup | ✅ Yes | hangup | `<Say>` + `<Hangup>` | autoBlacklist + autoTag |
| 4 | flag_only | ❌ No | respond | `<Say>` + `<Gather>` | autoTag |

---

## 🛠️ DEBUGGING TIPS

### If Edge Case Doesn't Trigger:
1. Check `config.edgeCases[]` in MongoDB (CheatSheetVersion where status='live')
2. Check Redis cache: `GET cheatsheet:live:{companyId}`
3. Verify PolicyCompiler compiled patterns correctly
4. Check `detectEdgeCase()` logs (debug level)

### If Wrong Action Type:
1. Check `edgeCase.action.type` in MongoDB
2. Verify CheatSheetEngine reads `action.type` correctly
3. Check backward compatibility (legacy vs enterprise mode)

### If Short-Circuit Fails:
1. For flag_only: Should NOT short-circuit (verify `[3TIER]` log appears)
2. For others: Should short-circuit (verify NO `[3TIER]` log)
3. Check return statement in CheatSheetEngine.apply()

### If Auto-Blacklist Doesn't Fire:
1. Check `sideEffects.autoBlacklist: true` in edge case config
2. Check SmartCallFilter.autoAddToBlacklist() logs
3. Verify company has auto-blacklist enabled globally
4. Check blacklist threshold (may need multiple detections)

---

## ✅ FINAL VALIDATION CHECKLIST

Before marking Edge Cases as production-ready:

### Functionality
- [ ] Test 1A passes (legacy override)
- [ ] Test 1B passes (enterprise override)
- [ ] Test 2 passes (force transfer)
- [ ] Test 3 passes (polite hangup)
- [ ] Test 4 passes (flag only)

### Logging
- [ ] All 4 critical logs appear for each test
- [ ] `appliedBlocks[]` includes edge case details
- [ ] `actionType` field correct in all logs
- [ ] `shortCircuit` flag correct (true for 1-3, false for 4)

### Behavior
- [ ] Override: Agent speaks override text, call continues
- [ ] Transfer: Agent transfers to correct contact
- [ ] Hangup: Call terminates gracefully
- [ ] Flag: Agent continues normal flow despite match

### Side Effects
- [ ] Auto-blacklist adds number to blacklist (Test 3)
- [ ] Auto-tags appear in logs (Tests 1B, 2, 3, 4)
- [ ] Log severity levels correct (info/warning/critical)

### Production Readiness
- [ ] Migration script tested (`scripts/migrate-edge-cases-to-enterprise.js`)
- [ ] Backward compatibility confirmed (legacy edge cases still work)
- [ ] Redis cache invalidates on save
- [ ] No performance degradation (<10ms edge case detection)

---

## 🚀 NEXT STEPS AFTER VALIDATION

Once all tests pass:

1. **Push to Production**:
   ```bash
   git push origin main
   ```

2. **Deploy Enterprise Pack**:
   - Use templates from `docs/EDGE-CASES-ENTERPRISE-PACK.md`
   - Start with PCI/High-Risk Data (highest priority)
   - Roll out to pilot company first

3. **Monitor Production**:
   - Track edge case trigger rates
   - Watch for false positives
   - Adjust keywords based on real transcripts

4. **Scale to All Companies**:
   - Export successful configurations
   - Customize per-industry/company
   - Enable auto-blacklist for abuse cases

---

**Validation Test Version**: 1.0  
**Last Updated**: November 27, 2025  
**Status**: Ready to Execute ✅

