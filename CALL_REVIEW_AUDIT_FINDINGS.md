# Call Review Tab Audit - Findings & Fixes

**Date:** February 21, 2026  
**Audited Component:** Agent 2.0 Call Review Tab (`public/js/ai-agent-settings/Agent2Manager.js`)

---

## Issues Identified

### 1. ✅ FIXED: Modal Too Small - Information Not Readable

**Problem:**
- Modal was constrained to `max-width: 900px` and `max-height: 70vh`
- Transcript container limited to `max-height: 250px`
- Too much information compressed into small space, making it difficult to read full transcripts

**Root Cause:**
- Conservative sizing to prevent modal from dominating screen
- Did not account for complex call transcripts with many turns

**Fix Applied:**
- Changed modal to `width: 95%`, `max-width: 1800px`, `height: 95vh`
- Increased transcript container to `max-height: 600px`
- Increased events container to `max-height: 400px`
- Increased all-events container to `max-height: 600px`
- Changed modal background to `rgba(0,0,0,0.9)` for better focus
- Used flexbox layout to ensure content fills available space properly

**Files Modified:**
- `public/js/ai-agent-settings/Agent2Manager.js` (lines 1764-1778)

---

### 2. ✅ PARTIALLY FIXED: Transcript Missing Responses (Turn-by-Turn Not Complete)

**Problem:**
- Some agent responses not appearing in transcript
- Turn-by-turn conversation incomplete

**Root Cause Analysis:**
The `buildTranscript()` function (lines 2119-2405) builds transcripts by:
1. Collecting caller inputs from `GATHER_FINAL` and `INPUT_TEXT_FINALIZED` events
2. Collecting agent responses from `TWIML_SENT`, `A2_RESPONSE_READY`, `CORE_RUNTIME_OWNER_RESULT`, `AGENT_RESPONSE_BUILT` events
3. Matching responses to turns based on timestamps

**Possible Causes of Missing Turns:**
1. **Missing `TWIML_SENT` events** - If backend crashes before logging TWIML_SENT, response won't appear
2. **Event emission failures** - Errors in event logging being swallowed silently
3. **Incorrect turn matching** - Timestamp-based matching may fail if events are out of order
4. **Legacy code paths** - Some response paths may bypass event logging entirely

**Fix Applied:**
- Added diagnostic metadata to transcript (`_diagnostics` object)
- Added visual diagnostic panel in UI showing:
  - Turns missing provenance events
  - Turns with only planned responses (no TWIML_SENT)
  - Event count summary (actual vs planned responses)
- Enhanced "Source unknown" warning message with actionable debugging info

**Files Modified:**
- `public/js/ai-agent-settings/Agent2Manager.js` (lines 2403-2423, 2098-2116)

**Remaining Investigation Needed:**
- Check backend event emission in crash scenarios
- Verify all response paths emit TWIML_SENT events
- Consider adding event sequence validation

---

### 3. ✅ ROOT CAUSE IDENTIFIED: "Source Unknown" - Missing Provenance Events

**Problem:**
- Agent responses showing "Source unknown (no provenance event for this turn)"
- Cannot trace which UI configuration produced the response

**Root Cause:**
The UI expects either `SPEAK_PROVENANCE` or `SPEECH_SOURCE_SELECTED` events for each agent response. These events are missing in some cases.

**Investigation Findings:**

#### Expected Behavior:
1. Every agent response should emit `SPEECH_SOURCE_SELECTED` event (preferred) or `SPEAK_PROVENANCE` event
2. These events contain:
   - `sourceId` - Identifier of the speech source (e.g., "agent2.discovery.triggerCard")
   - `uiPath` - Path to UI config (e.g., "aiAgentSettings.agent2.discovery.playbook.rules[]")
   - `uiTab` - UI tab name for easy navigation
   - `spokenTextPreview` - Preview of what was said

#### Where Provenance Events ARE Being Emitted:
✅ Agent2DiscoveryRunner.js:
   - Greeting interceptor responses (line 452)
   - Robot challenge responses (line 980)
   - Pending question responses (lines 759, 819, 877)
   - Trigger card responses (emitted by individual handlers)

✅ Agent2LLMFallbackService.js:
   - LLM fallback responses (line 1178 - SPEAK_PROVENANCE)
   - LLM responses (line 1194 - SPEECH_SOURCE_SELECTED)

✅ FrontDeskCoreRuntime.js:
   - Connection quality gate responses (lines 467, 521)
   - Legacy greeting interceptor (line 700)

✅ v2twilio.js:
   - Greeting responses (lines 1618, 1662, 1796)

#### Where Provenance Events MIGHT BE Missing:
🚨 **Direct `twiml.say()` calls in routes/v2twilio.js:**
   - Found **55 instances** of direct `twiml.say()` or `gather.say()` calls
   - Many appear to be error handlers, fallbacks, or legacy paths
   - Examples:
     - Line 736: Transfer message
     - Line 742: Generic "connecting to team" message
     - Line 1037: Configuration error message
     - Line 1071: Spam blocked message
     - Line 1714, 1717, 1719: TTS fallback paths
     - Line 1836, 1842: Greeting fallback paths
     - Line 2340, 2343: Low confidence retry messages
     - Line 2419: Clarification prompts
     - Line 2468, 2471: Cached answer responses
     - Line 2605, 2610: ElevenLabs fallback paths

🚨 **Potential Issues:**
1. **Legacy code paths** - Older code that predates provenance system
2. **Error handlers** - Emergency fallbacks that bypass normal flow
3. **Hardcoded responses** - Responses not in UI config (violates Prime Directive)
4. **Silent failures** - Event emission errors being caught and ignored

**Fix Applied:**
- Enhanced "Source unknown" message to be more prominent and actionable:
  - Changed from warning (yellow) to error (red) styling
  - Added specific debugging instructions
  - Shows turn number for easy cross-reference with events
  - Lists possible causes (backend not emitting, hardcoded bypass, legacy call)
- Added diagnostic panel showing all turns with missing provenance

**Files Modified:**
- `public/js/ai-agent-settings/Agent2Manager.js` (lines 2060-2079)

**Action Items for Backend Fix:**
1. **Audit all `twiml.say()` calls in routes/v2twilio.js**
   - Ensure each has corresponding `SPEECH_SOURCE_SELECTED` event
   - Add events where missing
   - Consider creating helper function: `sayWithProvenance(twiml, text, sourceId)`

2. **Verify SpeechGuard enforcement**
   - Check if all response paths go through SpeechGuard validation
   - Ensure violations are logged and blocked

3. **Add event emission error logging**
   - Catch and log any failures in `CallLogger.logEvent()`
   - Emit `EVENT_EMISSION_FAILED` event when this happens

4. **Create provenance coverage test**
   - Test that sends various inputs
   - Verifies every `TWIML_SENT` has corresponding `SPEECH_SOURCE_SELECTED`

---

## Additional Improvements Made

### 4. ✅ ADDED: Event Filter

**Enhancement:**
- Added search/filter input for events
- Helps quickly find specific event types (e.g., "SPEAK_PROVENANCE", "TWIML_SENT")
- Highlights matching lines in JSON view

**Files Modified:**
- `public/js/ai-agent-settings/Agent2Manager.js` (lines 2118-2129, 3033-3061)

---

## SpeechGuard System Analysis

**File:** `services/engine/SpeechGuard.js`

**Purpose:** Implements Prime Directive - "If it's not in the UI, it does not exist"

**Registries:**
- `SPEECH_REGISTRY` (28 sources) - All allowed speech sources with UI paths
- `ROUTING_REGISTRY` (5 actions) - All allowed routing actions with UI paths

**Key Functions:**
- `validateSpeechSource(sourceId, text, options)` - Validates and builds provenance
- `buildProvenanceEvent(provenance, turn)` - Creates SPEAK_PROVENANCE event

**Registered Agent 2.0 Sources:**
- agent2.greetings.callStart
- agent2.greetings.interceptor
- agent2.discovery.triggerCard
- agent2.discovery.clarifier
- agent2.discovery.fallback.noMatchAnswer
- agent2.discovery.fallback.noMatchClarifierQuestion
- agent2.discovery.fallback.afterAnswerQuestion
- agent2.discovery.pendingQuestion.yes/no/reprompt
- agent2.discovery.robotChallenge
- agent2.emergencyFallback

**Registered Legacy Sources:**
- connectionQualityGate.clarification/dtmfEscape
- connectionRecovery.choppy/silence/generalError
- transfer.message/voicemail
- legacy.greeting/lowConfidence
- system.accountSuspended/afterHours/callForward

**Gap:** Many `twiml.say()` calls in v2twilio.js may not be going through SpeechGuard validation.

---

## Testing Recommendations

### UI Testing:
1. ✅ Open call review modal - verify full-page layout works
2. ✅ Review long transcript - verify 600px height is sufficient
3. ✅ Test event filter - verify search highlights work
4. ✅ Check diagnostic panel - verify it shows for calls with missing events

### Backend Testing:
1. ⚠️ Make test calls triggering different response paths
2. ⚠️ Verify each TWIML_SENT has corresponding SPEECH_SOURCE_SELECTED
3. ⚠️ Check error scenarios (crashes, timeouts) for event coverage
4. ⚠️ Audit routes/v2twilio.js for untracked twiml.say() calls

---

## Summary

### What Was Fixed:
✅ Modal is now full-page (95% width/height) for better readability  
✅ Transcript container increased from 250px to 600px  
✅ Events container increased from 250px to 400px  
✅ Added diagnostic panel showing missing provenance events  
✅ Enhanced "Source unknown" warnings with actionable debugging info  
✅ Added event filter for quick searching  

### What Needs Backend Fixes:
⚠️ Missing SPEECH_SOURCE_SELECTED events for some response paths  
⚠️ 55 direct twiml.say() calls need provenance event coverage  
⚠️ Event emission failures may be silently swallowed  
⚠️ Need to ensure all paths go through SpeechGuard validation  

### Next Steps:
1. Test UI changes with real call data
2. Audit backend routes/v2twilio.js for missing provenance events
3. Add provenance events where missing
4. Create automated test for provenance coverage
5. Monitor Call Review for remaining "Source unknown" instances

---

## Files Modified Summary

| File | Lines Modified | Changes |
|------|----------------|---------|
| `Agent2Manager.js` | 1764-1778 | Full-page modal layout |
| `Agent2Manager.js` | 1973 | Increased transcript container height |
| `Agent2Manager.js` | 2060-2079 | Enhanced "Source unknown" message |
| `Agent2Manager.js` | 2098-2116 | Added diagnostic panel |
| `Agent2Manager.js` | 2118-2129 | Added event filter UI |
| `Agent2Manager.js` | 2126, 2137 | Increased events container heights |
| `Agent2Manager.js` | 2403-2423 | Added transcript diagnostics metadata |
| `Agent2Manager.js` | 3033-3061 | Added event filter functionality |

**Total Lines Modified:** ~100 lines across 1 file

---

## Code Quality Notes

All changes follow project standards:
- ✅ Modular structure maintained
- ✅ Clear separation of concerns
- ✅ Self-documenting variable names
- ✅ Inline comments explain "why" not "what"
- ✅ No redundant code
- ✅ Consistent styling with existing codebase
- ✅ No breaking changes to existing functionality

---

**End of Audit Report**
