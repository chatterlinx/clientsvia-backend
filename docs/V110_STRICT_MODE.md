# V110 STRICT MODE - Nuclear Protocol Enforcement

**Date:** 2026-02-13  
**Status:** ✅ **ACTIVE**  
**Trigger:** Discovery Flow configured in UI

---

## What Changed

Implemented **V110 STRICT MODE** - a nuclear option that completely disables ALL hardcoded logic when Discovery Flow is configured in the UI.

### Detection Logic

```javascript
const hasDiscoveryFlow = getConfig('frontDesk.discoveryFlow.steps', []).length > 0;
const v110StrictMode = hasDiscoveryFlow;
```

**If `v110StrictMode === true`:**
- ✅ Discovery Flow configured → STRICT MODE ACTIVE
- ❌ ALL hardcoded patterns DISABLED
- ❌ ALL smart patterns DISABLED  
- ❌ ALL fallback logic DISABLED
- ✅ Agent follows ONLY UI configuration

**If `v110StrictMode === false`:**
- ❌ No Discovery Flow → LEGACY MODE
- ✅ Hardcoded patterns enabled (backward compatibility)
- ✅ Smart patterns enabled
- ✅ Fallback logic enabled

---

## V110 STRICT MODE Rules

### Rule 1: Discovery Always Runs First
```javascript
if (discoveryTurnCount === 0) {
    return LANES.DISCOVERY;  // ALWAYS
}
```

No exceptions. No bypasses. Discovery runs on Turn 1.

### Rule 2: ONLY UI-Configured Triggers
After Discovery runs, the ONLY way to trigger booking is through UI-configured detection triggers:
- `frontDesk.detectionTriggers.wantsBooking`
- `frontDesk.detectionTriggers.directIntentPatterns`

If these are empty, booking is **NEVER** triggered automatically.

### Rule 3: No Smart Patterns
All hardcoded "smart patterns" are DISABLED:
- ❌ "I'm having AC problems" → Does NOT trigger booking
- ❌ "Can you send someone out?" → Does NOT trigger booking
- ❌ "I need help" → Does NOT trigger booking

Only patterns YOU configure in the UI will work.

### Rule 4: ConversationEngine Takes Over
If no UI-configured trigger matches, the agent stays in Discovery and lets ConversationEngine handle the conversation. The LLM can:
- Ask clarifying questions
- Collect more discovery info
- Explicitly offer booking when appropriate

---

## What Was Nuked

### Nuked #1: Fallback Patterns
**Before:**
```javascript
const FALLBACK_PATTERNS = [
    'schedule', 'book', 'appointment', 'come out', 'send someone',
    'get someone', 'need someone', 'help me out', 'technician'
];
```
**After (V110 STRICT):** These never execute. Skipped entirely.

### Nuked #2: Smart Patterns (All 15+)
**Before:**
```javascript
const smartPatterns = [
    /\b(air\s+condition|ac).{0,20}(problem|issue)/i,  // ← This one was the problem
    /\b(get|send|dispatch).+(someone|tech).+(out|over)/i,
    /\bcan\s+you\s+help\b/i,
    // ... 12 more patterns
];
```
**After (V110 STRICT):** None of these execute. Agent ignores them all.

### Nuked #3: Discovery Protection Logic
**Before:** Had complex protection logic to prevent smart patterns on Turn 1

**After (V110 STRICT):** Don't need protection - smart patterns never run at all!

---

## Behavior Comparison

### Before (Hybrid Mode)
```
Turn 1: "I'm having AC problems"
  → Smart pattern: /\b(air\s+condition).{0,20}(problem)/i
  → Matches! → LANE_SELECTED: BOOKING
  → bookingModeLocked = true
  → Discovery Flow SKIPPED
  → Goes straight to lastName
```

### After (V110 STRICT MODE)
```
Turn 1: "I'm having AC problems"
  → v110StrictMode = true
  → discoveryTurnCount = 0
  → LANE_SELECTED: DISCOVERY (forced)
  → Discovery passive capture runs
  → Extracts: name, call_reason_detail
  → Response: "Got it, what's the best number to reach you?"
  → discoveryTurnCount = 1

Turn 2: User continues conversation
  → v110StrictMode = true
  → discoveryTurnCount = 1 (Discovery ran)
  → Checks UI-configured triggers ONLY
  → If match: BOOKING
  → If no match: DISCOVERY (LLM handles)
```

---

## How to Configure V110 STRICT MODE

### Step 1: Configure Discovery Flow
In the UI, add at least ONE Discovery Flow step:

```json
{
  "frontDesk": {
    "discoveryFlow": {
      "steps": [
        { "slotId": "name", "prompt": "What's your name?" },
        { "slotId": "phone", "prompt": "What's your phone number?" },
        { "slotId": "call_reason_detail", "prompt": "What can I help you with?" }
      ]
    }
  }
}
```

**Result:** V110 STRICT MODE activates immediately.

### Step 2: Configure Detection Triggers (Optional)
If you want specific phrases to trigger booking after Discovery:

```json
{
  "frontDesk": {
    "detectionTriggers": {
      "wantsBooking": [
        "schedule",
        "book an appointment",
        "come out today"
      ]
    }
  }
}
```

If you DON'T configure these, the agent will rely on ConversationEngine (LLM) to decide when to offer booking.

---

## Logging & Debugging

When V110 STRICT MODE is active, you'll see these log messages:

### Turn 1 (Discovery Required)
```
[FRONT_DESK_RUNTIME] V110 STRICT MODE: Discovery Flow configured - disabling ALL hardcoded patterns
{
  discoveryTurnCount: 0,
  message: 'Agent will ONLY follow UI configuration'
}
```

### Turn 2+ (UI Trigger Check)
```
[FRONT_DESK_RUNTIME] V110 STRICT MODE: No UI triggers matched - staying in Discovery
{
  configuredTriggersCount: 0
}
```

### Legacy Mode (No Discovery Flow)
```
[FRONT_DESK_RUNTIME] LEGACY MODE: No V110 Discovery Flow - using hardcoded patterns
{
  message: 'Configure Discovery Flow in UI to enable V110 STRICT MODE'
}
```

---

## Raw Events Validation

After deploying, verify V110 STRICT MODE is working:

### ✅ MUST SEE in raw events:
```json
{
  "type": "DECISION_TRACE",
  "data": {
    "reason": "v110_strict_mode_discovery_required",
    "strictMode": true,
    "discoveryTurnCount": 0
  }
}

{
  "type": "LANE_SELECTED",
  "lane": "DISCOVERY"  // ← Turn 1 ALWAYS Discovery
}
```

### ❌ MUST NOT SEE:
```json
{
  "type": "DECISION_TRACE",
  "data": {
    "reason": "smart_pattern_match",  // ← Should NEVER appear
    "pattern": "\\b(air\\s+condition"
  }
}

{
  "type": "LANE_SELECTED",
  "lane": "BOOKING",
  "turn": 1  // ← Booking on Turn 1 is VIOLATION
}
```

---

## Rollback Plan

If V110 STRICT MODE causes issues:

### Option 1: Disable Discovery Flow
Remove all steps from `frontDesk.discoveryFlow.steps` → Reverts to LEGACY MODE

### Option 2: Code Rollback
```bash
git revert HEAD
git push
```

---

## Impact on Existing Companies

### Companies WITH Discovery Flow Configured
- ✅ V110 STRICT MODE activates automatically
- ✅ Hardcoded patterns disabled
- ✅ Agent follows ONLY UI configuration

### Companies WITHOUT Discovery Flow
- ✅ LEGACY MODE continues (backward compatible)
- ✅ Hardcoded patterns still work
- ✅ Smart patterns still work
- ✅ No behavior change

**Zero breaking changes for legacy companies.**

---

## Success Metrics

After deploying V110 STRICT MODE:

1. **Discovery Turn 1 Rate:** Should be 100% for V110 companies
2. **Smart Pattern Fire Rate:** Should be 0% for V110 companies
3. **UI Trigger Accuracy:** All booking triggers should be from UI config
4. **Protocol Violations:** Should be 0

---

## Future Enhancements

Once V110 STRICT MODE proves stable:

1. **Add UI Toggle:** Allow companies to explicitly enable/disable STRICT MODE
2. **Add Diagnostics:** Show which patterns were disabled in raw events
3. **Add Migration Tool:** Auto-convert legacy companies to V110
4. **Add Validation:** Warn if Discovery Flow is empty or misconfigured

---

## Sign-Off

**Feature:** V110 STRICT MODE (Nuclear Protocol Enforcement)  
**Status:** ✅ DEPLOYED  
**Risk:** LOW (backward compatible, opt-in via Discovery Flow config)  
**Impact:** HIGH (fixes all protocol violations for V110 companies)  

The nuclear option is live. If Discovery Flow is configured, V110 is now the ONLY truth. 🚀
