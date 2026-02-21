# Backend Fix Guide - Adding Missing Provenance Events

## Quick Reference for Fixing "Source Unknown" Issues

---

## The Problem

Agent responses are appearing in Call Review with "Source unknown" because `SPEECH_SOURCE_SELECTED` or `SPEAK_PROVENANCE` events are not being emitted for all response paths.

---

## The Solution Pattern

Every time you call `twiml.say()`, `gather.say()`, or `twiml.play()`, you MUST emit a `SPEECH_SOURCE_SELECTED` event.

### Template for Adding Provenance Events

```javascript
// BEFORE - Missing provenance event
twiml.say('I am connecting you to our team.');

// AFTER - With provenance event
CallLogger.logEvent({
  callId: callSid,
  companyId: companyID,
  type: 'SPEECH_SOURCE_SELECTED',
  turn: turnNumber,
  data: {
    sourceId: 'transfer.message',  // Must be registered in SpeechGuard.SPEECH_REGISTRY
    uiPath: 'aiAgentSettings.transferSettings.transferMessage',
    uiTab: 'Transfer Settings',
    configPath: 'transferSettings.transferMessage',
    spokenTextPreview: 'I am connecting you to our team.',
    note: 'Transfer initiated by user request'  // Optional context
  }
}).catch(err => {
  logger.error('[PROVENANCE] Failed to log SPEECH_SOURCE_SELECTED', { error: err.message });
});

twiml.say('I am connecting you to our team.');
```

---

## Step-by-Step Fix Process

### Step 1: Identify All `twiml.say()` Calls

Search for:
- `twiml.say(`
- `gather.say(`
- `twiml.play(`

Found **55 instances** in `routes/v2twilio.js` that need review.

### Step 2: For Each Call, Determine the Source

Ask yourself:
1. **Is this from UI config?** → Use existing UI path
2. **Is this a hardcoded fallback?** → Should it be in UI? If not, use system source
3. **Is this an error message?** → Use appropriate system source

### Step 3: Check if Source is Registered in SpeechGuard

Open `services/engine/SpeechGuard.js` and check if the sourceId exists in `SPEECH_REGISTRY`.

If not registered, add it:

```javascript
// In SpeechGuard.js SPEECH_REGISTRY
'yourSourceId': {
  uiPath: 'path.to.ui.config',
  uiTab: 'UI Tab Name',
  configPath: 'backend.config.path',
  description: 'Human-readable description'
}
```

### Step 4: Add the Event Emission

Place the `CallLogger.logEvent()` call **immediately before** the `twiml.say()` call.

### Step 5: Test

1. Make a test call that triggers this response path
2. Open Call Review
3. Verify the response shows source attribution (no "Source unknown")

---

## Common Scenarios

### Scenario 1: UI-Configured Message

```javascript
// Example: Transfer message from UI config
const transferMessage = company.aiSettings?.transferSettings?.transferMessage 
  || "I'm connecting you to our team.";

CallLogger.logEvent({
  callId: callSid,
  companyId: company._id,
  type: 'SPEECH_SOURCE_SELECTED',
  turn: turnNumber,
  data: {
    sourceId: 'transfer.message',
    uiPath: 'aiAgentSettings.transferSettings.transferMessage',
    uiTab: 'Transfer Settings',
    configPath: 'transferSettings.transferMessage',
    spokenTextPreview: transferMessage.substring(0, 120),
    note: company.aiSettings?.transferSettings?.transferMessage 
      ? 'Using UI-configured message' 
      : 'Using hardcoded fallback'
  }
}).catch(() => {});

twiml.say(transferMessage);
```

### Scenario 2: Error Handler / System Message

```javascript
// Example: Configuration error
CallLogger.logEvent({
  callId: callSid,
  companyId: company._id,
  type: 'SPEECH_SOURCE_SELECTED',
  turn: 0,
  data: {
    sourceId: 'system.configurationError',  // Must add to SpeechGuard.SPEECH_REGISTRY
    uiPath: 'SYSTEM_ERROR',
    uiTab: 'System',
    configPath: 'N/A',
    spokenTextPreview: 'Configuration error: Company must configure AI Agent Logic responses',
    note: 'System error - no UI config available'
  }
}).catch(() => {});

twiml.say('Configuration error: Company must configure AI Agent Logic responses');
```

### Scenario 3: Dynamic Response (LLM, TTS Fallback)

```javascript
// Example: TTS fallback path
const greetingText = initResult.greeting || 'Thank you for calling.';

CallLogger.logEvent({
  callId: callSid,
  companyId: company._id,
  type: 'SPEECH_SOURCE_SELECTED',
  turn: 0,
  data: {
    sourceId: initResult.greetingSource === 'agent2' 
      ? 'agent2.greetings.callStart' 
      : 'legacy.greeting',
    uiPath: initResult.greetingSource === 'agent2'
      ? 'aiAgentSettings.agent2.greetings.callStart.text'
      : 'connectionMessages.greeting',
    uiTab: initResult.greetingSource === 'agent2' 
      ? 'Agent 2.0 > Greetings' 
      : 'Connection Messages',
    configPath: initResult.greetingSource === 'agent2'
      ? 'agent2.greetings.callStart.text'
      : 'connectionMessages.greeting',
    spokenTextPreview: greetingText.substring(0, 120),
    note: 'TTS fallback - audio generation failed'
  }
}).catch(() => {});

gather.say(escapeTwiML(greetingText));
```

---

## Priority List - Files to Audit

### High Priority (Customer-Facing Responses)
1. ✅ `services/engine/agent2/Agent2DiscoveryRunner.js` - Already emits events
2. ✅ `services/engine/agent2/Agent2LLMFallbackService.js` - Already emits events
3. ⚠️ `routes/v2twilio.js` - **55 instances need review**

### Medium Priority (Error Handlers)
4. ⚠️ Error handlers in `routes/v2twilio.js`
5. ⚠️ Fallback paths in `routes/v2twilio.js`

### Low Priority (Legacy/Deprecated)
6. Legacy paths (if still in use)

---

## Specific Instances to Fix in routes/v2twilio.js

### Transfer Messages (Lines 733-750)
```javascript
// Line 736: Transfer announcement
// Line 742: Generic "connecting to team" message
// Line 749: Fallback message when transfer disabled
```
**Source IDs:** `transfer.message`, `transfer.fallback`

### Error Messages (Lines 1034-1945)
```javascript
// Line 1037: Configuration error
// Line 1071: Spam blocked message
// Line 1944: Service unavailable
```
**Source IDs:** `system.configurationError`, `system.spamBlocked`, `system.serviceUnavailable`

### Greeting Paths (Lines 1711-1883)
```javascript
// Line 1714, 1717, 1719: TTS fallback
// Line 1836, 1842: Greeting fallback paths
// Line 1883: Final fallback greeting
```
**Source IDs:** `agent2.greetings.callStart` or `legacy.greeting` (already have some events, verify all paths covered)

### Response Messages (Lines 2337-2611)
```javascript
// Line 2340, 2343: Low confidence retry
// Line 2419: Clarification prompt
// Line 2468, 2471: Cached answer
// Line 2605, 2610: ElevenLabs fallback
```
**Source IDs:** `legacy.lowConfidence`, `connectionQualityGate.clarification`, etc.

---

## Helper Function (Recommended)

Create a utility function to reduce boilerplate:

```javascript
// In routes/v2twilio.js or new file: services/TwimlHelpers.js

async function sayWithProvenance(twiml, text, sourceId, options = {}) {
  const {
    callId,
    companyId,
    turn = 0,
    uiPath,
    uiTab,
    configPath,
    note
  } = options;

  // Validate source is registered
  const SpeechGuard = require('../services/engine/SpeechGuard');
  if (!SpeechGuard.isSourceRegistered(sourceId)) {
    logger.error(`[PROVENANCE] Unregistered source: ${sourceId}`);
  }

  // Emit provenance event
  if (callId && companyId) {
    await CallLogger.logEvent({
      callId,
      companyId,
      type: 'SPEECH_SOURCE_SELECTED',
      turn,
      data: {
        sourceId,
        uiPath: uiPath || 'UNKNOWN',
        uiTab: uiTab || 'Unknown',
        configPath: configPath || 'N/A',
        spokenTextPreview: text.substring(0, 120),
        note: note || null
      }
    }).catch(err => {
      logger.error('[PROVENANCE] Failed to log event', { sourceId, error: err.message });
    });
  }

  // Say the text
  twiml.say(text);
}

// Usage:
await sayWithProvenance(twiml, transferMessage, 'transfer.message', {
  callId: callSid,
  companyId: company._id,
  turn: turnNumber,
  uiPath: 'aiAgentSettings.transferSettings.transferMessage',
  uiTab: 'Transfer Settings',
  configPath: 'transferSettings.transferMessage',
  note: 'User requested transfer'
});
```

---

## Validation Checklist

After fixing, verify:

- [ ] Every `TWIML_SENT` event has a corresponding `SPEECH_SOURCE_SELECTED` event
- [ ] All sourceIds are registered in SpeechGuard.SPEECH_REGISTRY
- [ ] Call Review shows source attribution for all agent responses
- [ ] No "Source unknown" warnings appear for new calls
- [ ] Diagnostic panel shows 0 missing provenance events

---

## Testing Commands

```bash
# 1. Make test calls
# 2. Check Call Review in UI
# 3. Look for diagnostic warnings

# Or use automated test:
npm run test:provenance-coverage  # (Create this test)
```

---

## Estimated Time

- Review all 55 instances: **2-3 hours**
- Add missing events: **3-4 hours**
- Test and validate: **1-2 hours**
- **Total: 6-9 hours**

---

## Questions?

Refer to:
- `services/engine/SpeechGuard.js` - Registry and validation
- `services/engine/agent2/Agent2DiscoveryRunner.js` - Example implementation
- `CALL_REVIEW_AUDIT_FINDINGS.md` - Full audit report

---

**End of Fix Guide**
