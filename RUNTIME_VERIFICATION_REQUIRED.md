# RUNTIME VERIFICATION REQUIRED - DO NOT SKIP

**Status:** Code is committed but **NOT VERIFIED** with real call data  
**Action Required:** User must run these tests before declaring "done"

---

## Git Truth ✅ VERIFIED

```bash
# Commits on origin/main:
b6303422 - Fix critical null safety issues
58d067cd - Enhanced Call Review transcript

# Files changed (as claimed):
- Agent2Manager.js (only file modified)
- VERIFICATION_REPORT.md (new)

# Changes (clean):
- 3 defensive null checks: (turnSummaries || []), (events || []), (!transcript)
- 1 text fallback: handles empty/null/whitespace-only
- No other files touched
- No refactors or debug code
```

✅ **Git truth verified - commits match claims exactly**

---

## Runtime Truth ❌ NOT VERIFIED - USER MUST TEST

### Required Browser Tests (DevTools Open):

#### Test 1: 0-Turn Call (Empty/Failed)
```
1. Open Agent 2.0 → Call Review
2. Find call with 0 turns (failed gather / immediate hangup)
3. Open DevTools Console (F12)
4. Click call to open modal
5. Check for:
   - ❌ Any red console errors
   - ❌ "Cannot read properties of null/undefined"
   - ✅ Modal opens showing "No transcript available"
```

**Expected Result:**
- No console errors
- Modal shows "No transcript available" message
- No crashes

**If fails:** Null check insufficient - report exact error

---

#### Test 2: 1-2 Turn Call (Small)
```
1. Open call with 1-2 turns only
2. DevTools Console open
3. Click call to open modal
4. Check:
   - ❌ Console errors
   - ✅ Caller turn shows (blue card)
   - ✅ Agent turn shows (green/yellow/red card)
   - ✅ Text displays correctly
```

**Expected Result:**
- 1-2 cards visible
- Colors match status
- No console errors

---

#### Test 3: Large Call (50+ Turns) - PERFORMANCE CHECK
```
1. Find largest call you have (50+ turns)
2. Open DevTools Console
3. Run this BEFORE clicking:
   console.time('modal-open');
4. Click call
5. When modal fully loaded, run:
   console.timeEnd('modal-open');
6. Check time and scroll performance
```

**Expected Result:**
- Modal open time: **< 500ms** = good, **< 1s** = acceptable, **> 1s** = bad
- Scroll: **> 30fps** = good, **< 30fps** = jank
- No console errors

**If > 1s or jank:** Need virtualization (next sprint) - create ticket

---

#### Test 4: Legacy Call (Missing Provenance)
```
1. Find old call (pre-V126) or one with missing events
2. DevTools Console open
3. Click call
4. Check:
   - ❌ Console errors
   - ✅ Red cards with "MISSING PROVENANCE" shown
   - ✅ No fabricated data (should show "unknown" not guesses)
```

**Expected Result:**
- Modal opens (no crash)
- Missing data shows clear error
- No guessing/fabrication

---

#### Test 5: Call with Empty speechResult
```
1. Find call where gather returned empty
2. DevTools Console open
3. Click call
4. Check:
   - ❌ Console errors
   - ✅ Shows "[No text available]" instead of ""
   - ✅ Card still renders correctly
```

**Expected Result:**
- Shows fallback text "[No text available]"
- Card displays in gray color (#6e7681)
- No console errors

---

#### Test 6: Transferred Call (Multiple Legs)
```
1. Find call with transfer (multiple assistant legs)
2. DevTools Console open
3. Click call
4. Check:
   - ❌ Console errors
   - ✅ All turns shown chronologically
   - ⚠️ May show confusing data (expected - not a bug)
```

**Expected Result:**
- Modal opens
- All turns visible
- No console errors (confusion is okay, crashes are not)

---

## UI Truth ❌ NOT VERIFIED - USER MUST CHECK

### DOM Duplication Check (CRITICAL)

**Run this in Browser DevTools Console while modal is open:**

```javascript
// Check for duplicate sections
const transcriptHeaders = [...document.querySelectorAll("*")]
  .filter(n => /^TRANSCRIPT$/i.test((n.textContent || "").trim()));

console.log('TRANSCRIPT headers found:', transcriptHeaders.length);
console.log('Expected: 1');

// Check for old sections (should be 0)
const oldSections = [...document.querySelectorAll("*")]
  .filter(n => /SPEAK PROVENANCE|TRUTH LINE/i.test(n.textContent));

console.log('Old sections found:', oldSections.length);
console.log('Expected: 0');
```

**Expected Output:**
```
TRANSCRIPT headers found: 1
Expected: 1
Old sections found: 0
Expected: 0
```

**If TRANSCRIPT > 1 or old sections > 0:** Hidden duplicates present - report immediately

---

### Card Validation (Visual Check)

**Verify these card types exist:**

1. **Caller Turn (Blue Border)**
   - Border: #2563eb (blue)
   - Icon: 📞
   - Shows: "Turn X - CALLER"
   - Content: Just text, no attribution

2. **Agent Turn - Normal (Green Border)**
   - Border: #4ade80 (green)
   - Icon: 🤖
   - Badge: [UI-OWNED]
   - Shows: Text + Source + UI Path + Runtime Info

3. **Agent Turn - Missing Provenance (Red Border)**
   - Border: #f43f5e (red)
   - Icon: 🚨
   - Badge: [MISSING PROVENANCE]
   - Shows: Error message (not guessed data)

4. **Agent Turn - Fallback (Yellow Border)**
   - Border: #f59e0b (yellow)
   - Icon: ⚠️
   - Badge: [FALLBACK] or [AUDIO FALLBACK → TTS]
   - Shows: Text + Source + Issues section

**Validation Rules:**
- ✅ Missing provenance shows ERROR, not fabricated data
- ✅ Source attribution only shows when event exists
- ✅ Empty text shows "[No text available]" in gray
- ✅ All fields use real data or show "unknown" / "?"

---

## Performance Measurement (REQUIRED)

### Modal Open Time Test:

```javascript
// Before clicking call:
console.time('modal-open');

// Click call... wait for modal to fully render

// After modal appears:
console.timeEnd('modal-open');
```

**Thresholds:**
- ✅ **< 500ms** - Ship it
- ⚠️ **500ms - 1s** - Acceptable, but watch for user complaints
- 🚨 **> 1s** - Don't ship without virtualization

---

## Console Output Examples

### GOOD (No Errors):
```
Console:
(nothing - silent is good)

modal-open: 342ms
```

### BAD (Console Errors):
```
Console:
❌ Uncaught TypeError: Cannot read properties of undefined (reading 'forEach')
    at Agent2Manager.renderEnhancedTranscript
```

**If you see this:** Null check missed - report exact error + call type

---

## Final Checklist (Copy/Paste Results)

```
□ Test 1 (0 turns): PASS / FAIL - Console output: ___________
□ Test 2 (1-2 turns): PASS / FAIL - Console output: ___________
□ Test 3 (50+ turns): PASS / FAIL - Time: _____ms, Scroll: SMOOTH / JANK
□ Test 4 (legacy): PASS / FAIL - Console output: ___________
□ Test 5 (empty text): PASS / FAIL - Shows fallback: YES / NO
□ Test 6 (transfer): PASS / FAIL - Console output: ___________
□ DOM check: TRANSCRIPT headers: ___, Old sections: ___
□ Performance: Modal open time: _____ms
```

---

## Governance Check (CRITICAL)

**Verify NO wiring changes outside Control Plane:**

```bash
# Check if any flow tree / wiring files changed:
git show --name-only 58d067cd b6303422 | grep -i "flow\|wiring\|tree"

# Expected output: (nothing)
# If any matches: STOP - wiring changes must go through proper flow
```

---

## Ship Criteria (ALL MUST PASS)

✅ **Git Truth:**
- Both commits on origin/main
- Only claimed files changed
- No refactors or debug code

❌ **Runtime Truth:** (USER MUST VERIFY)
- [ ] All 6 edge case tests pass (no console errors)
- [ ] Performance acceptable (< 1s modal open)
- [ ] No crashes on any call type

❌ **UI Truth:** (USER MUST VERIFY)
- [ ] DOM check shows 1 TRANSCRIPT, 0 old sections
- [ ] Cards display correctly (blue/green/yellow/red)
- [ ] Missing data shows errors, not fabricated values

❌ **Governance:** (USER MUST VERIFY)
- [ ] No wiring changes outside Control Plane
- [ ] All events logged to BlackBox
- [ ] Flow tree unchanged

---

## If ANY Test Fails:

**DO NOT SHIP**

Report:
1. Which test failed
2. Exact console error message
3. Call type (0-turn, large, legacy, etc.)
4. Screenshot if visual issue

I will fix the specific failure.

---

## Current Status Summary

| Area | Status | Evidence |
|------|--------|----------|
| Git Truth | ✅ VERIFIED | Commits on origin/main, clean diff |
| Runtime Truth | ❌ NOT TESTED | Requires real call data |
| UI Truth | ❌ NOT TESTED | Requires browser check |
| Performance | ❌ NOT TESTED | Requires large call test |
| Governance | ❌ NOT CHECKED | Requires flow tree verification |

**Overall:** Code is clean but **UNVERIFIED** - user must test before ship.

---

**Next Action:** User copies this file, runs all tests, pastes results.
