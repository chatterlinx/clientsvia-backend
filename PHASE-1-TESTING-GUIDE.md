# 🎯 PHASE 1 TESTING GUIDE

**Status:** Phase 1 implemented and pushed to `main`

---

## 📋 TEST PLAN

### Test Environment
- **Company:** Penguin Air (test tenant)
- **Channel:** VOICE only
- **AI Brain:** 3-tier routing
- **Logs:** Watch for `[PHASE 1]` markers

---

## 🧪 TEST SCENARIOS

### Test 1: Information Query (Hours of Operation)

**Test Call:**
```
Caller: "What are your hours?"
Expected: Should receive FULL hours response
```

**Success Criteria:**
```
✅ AI Brain matches "Hours of Operation" scenario
✅ Scenario has fullReplies (real hours, e.g., "Monday-Friday 8am-6pm")
✅ Scenario has quickReplies (e.g., "We're open during business hours")
✅ Log shows: [PHASE 1] VOICE channel + fullReplies available
✅ Voice plays FULL reply (actual hours, not quick "We're here to help!")
✅ Call duration reasonable
```

**Failure Signs:**
```
❌ Voice plays only quickReply ("We're here to help!")
❌ Hears old Twilio fallback text
❌ No [PHASE 1] log marker
❌ AI Brain returns null response
```

---

### Test 2: Action-Oriented Query (Booking)

**Test Call:**
```
Caller: "I'd like to book an appointment"
Expected: May get quick OR full reply (30% quick, 70% full)
```

**Success Criteria:**
```
✅ AI Brain matches "Book Appointment" or similar scenario
✅ If scenario tagged as non-info: may use quickReply (70% chance)
✅ OR gets FULL reply with booking flow (70% chance)
✅ Both are acceptable (depends on scenario strategy)
✅ Voice sounds natural, not generic fallback
```

**Failure Signs:**
```
❌ No scenario matched (AI Brain failed)
❌ Receives generic "I'm connecting you" fallback
❌ Twilio voice replaces ElevenLabs mid-call
```

---

### Test 3: SMS Channel Check (Regression)

**Test Call:**
```
Sender: SMS to Penguin Air
Message: "What are your hours?"
Expected: SMS reply (may be quick or full, keyword-based)
```

**Success Criteria:**
```
✅ SMS received (not broken)
✅ Reply is reasonable (quick or full, both acceptable)
✅ No [PHASE 1] marker in logs (SMS should NOT use Phase 1 logic)
✅ Existing SMS behavior preserved
```

**Failure Signs:**
```
❌ SMS not received
❌ SMS reply is null/empty
❌ SMS response changed unexpectedly
```

---

## 📊 LOG CHECKLIST

Watch `Render logs` for these patterns:

### Expected Logs (Good):

```
[PHASE 1] VOICE channel + fullReplies available - using FULL replies
  ✅ Shows Phase 1 optimization triggered
  ✅ Scenario had fullReplies available

[REPLY SELECTION] Information scenario detected - using FULL replies
  ✅ Information scenario recognized (hours, pricing, etc.)
  ✅ Falls back to legacy logic if non-voice or no fullReplies

[REPLY SELECTION] <actual hours text>
  ✅ Voice response played to caller
```

### Unexpected Logs (Problem):

```
TypeError: Cannot read properties
  ❌ Redis or connection issue

"We're here to help!" (in voice logs)
  ⚠️ Quick reply selected (check if fullReplies should be used)

[TIER 3] Scenario has NO replies
  ⚠️ Template is broken (scenario has no replies defined)

Error in v2elevenLabsService
  ❌ ElevenLabs voice synthesis failed
```

---

## 🎬 HOW TO RUN TESTS

### Option 1: Live Call Testing
1. Call Penguin Air's test number
2. Say "What are your hours?" (or similar info query)
3. Listen for full response (not generic greeting)
4. Check Render logs for `[PHASE 1]` marker

### Option 2: Admin Console Trace
1. Use Admin Console to send test request
2. Look for scenario match in trace
3. Check reply type (quick vs full) in metadata
4. Verify channel is 'voice' in context

### Option 3: Manual Log Check
1. Go to Render dashboard
2. View recent logs
3. Search for `[PHASE 1]` or `[REPLY SELECTION]`
4. Verify voice calls use FULL replies

---

## ✅ WHAT PHASE 1 FIXES

| Issue | Before | After |
|-------|--------|-------|
| **Voice hours query** | "We're here to help!" | "Mon-Fri 8am-6pm, Sat 9am-2pm" |
| **Voice pricing query** | Generic greeting | Full price list/rates |
| **Voice service query** | Quick reply only | Full service description |
| **SMS hours query** | May get full or quick | Same (unchanged) |
| **Booking flow** | Random 30% quick | Still 30% random quick |

---

## 🚨 ROLLBACK PROCEDURE

If issues found:

```bash
# Revert Phase 1 to previous commit
git revert 1cbd44fc --no-edit

# Or if not yet pushed:
git reset --hard HEAD~1
```

**Note:** Single commit, easy to revert. Zero data loss risk.

---

## 📈 SUCCESS METRICS

After Phase 1 testing:

- ✅ Info query calls get full reply 95%+ of the time
- ✅ No more "We're here to help!" on hours/pricing questions
- ✅ SMS/chat behavior unchanged
- ✅ ElevenLabs voice plays full response without fallback
- ✅ Logs show `[PHASE 1]` markers for voice calls

---

## 🎯 NEXT STEPS

After Phase 1 verified:

1. **Phase 2:** Add `scenarioType` and `replyStrategy` to schema
2. **Phase 3:** Create standalone `ResponseEngine.js` service
3. **Phase 4:** Wire Response Engine into AIBrain
4. **Phase 5:** Testing + documentation

---

**Test Owner:** [Your Name]
**Test Date:** [Date]
**Status:** Ready for testing

