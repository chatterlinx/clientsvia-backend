# Call Review Transcript - Runtime Verification (REQUIRED)

**Status:** Code deployed, **NOT VERIFIED** with real calls  
**Required:** Run ALL tests below before shipping

---

## 0) PREP (No Excuses)

```
1. Open Admin UI in browser
2. Hard refresh + disable cache:
   Chrome DevTools → Network tab → ✅ Disable cache
3. Open DevTools:
   ✅ Console tab visible
   ✅ Network tab visible
```

**READY?** Proceed to tests.

---

## 1) SMOKE TEST: Modal Opens + No Console Errors

### Steps:
```
1. Go to Agent 2.0 Settings → Call Review tab
2. Click ANY recent call to open modal
```

### Expected:
- ✅ Modal opens (full-page / large)
- ✅ Transcript cards render
- ✅ **Console shows ZERO red errors**

### HARD FAIL:
- ❌ Any red console error
- ❌ Modal doesn't open
- ❌ White screen / frozen UI

### Paste if FAIL:
```
Screenshot or copy/paste console red error (top 20 lines)
```

---

## 2) EDGE CASE TEST MATRIX (6 Required Calls)

### A) 0-Turn Call (Empty / Failed Gather)

**Find:** Call with 0 turns (immediate hangup / failed gather)

**PASS:**
- ✅ No crash
- ✅ Transcript shows empty state message
- ✅ No console errors

**FAIL:**
- ❌ "Cannot read properties of null/undefined"
- ❌ Card renderer crashes

**Paste if FAIL:** Console error

---

### B) 1–2 Turn Call (Small)

**Find:** Call with 1-2 turns only

**PASS:**
- ✅ Cards show correct order
- ✅ Turn # matches reality
- ✅ No duplicate transcript sections
- ✅ No console errors

**FAIL:**
- ❌ Wrong turn order
- ❌ Duplicate sections visible

**Paste if FAIL:** Screenshot of cards + console

---

### C) 50+ Turn Call (Performance)

**Find:** Largest call you have (50+ turns)

**PASS:**
- ✅ Modal open feels acceptable
- ✅ Scroll is smooth enough to read
- ✅ No memory explosion / browser hang

**FAIL:**
- ❌ Modal takes > 1s to open
- ❌ Scroll is jank / laggy
- ❌ Browser freezes

**Paste if FAIL:** Performance time (see test #4 below)

---

### D) Legacy / Missing Provenance Call

**Find:** Old call (pre-V126) or one with missing events

**PASS:**
- ✅ "MISSING PROVENANCE" red cards appear
- ✅ No guessed/faked attribution
- ✅ Shows "unknown" or "?" for missing fields

**FAIL:**
- ❌ UI claims speechSource when it doesn't exist
- ❌ Fabricated provenance data

**Paste if FAIL:** Screenshot of bad card + raw events

---

### E) Empty speechResult Call (Audio Present, Text Empty)

**Find:** Call where gather returned empty/null text

**PASS:**
- ✅ Text shows `[No text available]` (not blank quotes)
- ✅ Card renders in gray color
- ✅ No crash

**FAIL:**
- ❌ Shows empty quotes ""
- ❌ Crash on render

**Paste if FAIL:** Screenshot + console

---

### F) Transfer / Multi-Leg Call

**Find:** Call with transfer (multiple assistant legs)

**PASS:**
- ✅ Turns don't get duplicated
- ✅ Agent vs caller labeling consistent
- ✅ No reordering bugs

**FAIL:**
- ❌ Duplicate turns
- ❌ Wrong speaker labels
- ❌ Confused turn order

**Paste if FAIL:** Screenshot showing issue

---

## 3) DOM DUPLICATION CHECK (Run Once)

**Open any call modal, then run in DevTools Console:**

```javascript
(() => {
  const hits = [...document.querySelectorAll("*")]
    .filter(n => /^TRANSCRIPT$/i.test((n.textContent || "").trim()));
  console.log("TRANSCRIPT headers:", hits.length);
  return hits.length;
})();
```

**Expected:** `1`

**FAIL:** `> 1` (duplicate sections still exist)

**Paste if FAIL:** Actual count + screenshot of DOM tree

---

## 4) MODAL OPEN TIME (Performance Number)

**In DevTools Console (before clicking call):**

```javascript
console.time("modal-open");
```

**Click call to open modal**

**After modal fully renders, run:**

```javascript
console.timeEnd("modal-open");
```

**Targets:**
- ✅ `< 500ms` = excellent
- ⚠️ `500ms–1000ms` = acceptable
- 🚨 `> 1000ms` = need virtualization (next sprint)

**Paste:** Actual time in ms

---

## 5) TRUTH INTEGRITY SPOT CHECK (2 Turns)

**Pick one caller turn + one agent turn, verify:**

### Caller Turn:
- ✅ If speechResult exists, attribution reflects it
- ✅ If missing, shows unknown/missing (not made-up)

### Agent Turn:
- ✅ If SPEAK_PROVENANCE exists, shows it
- ✅ If missing, shows "MISSING PROVENANCE" error
- ✅ Nothing looks "guessed" or contradictory to raw events

**FAIL:** Anything fabricated or contradictory

**Paste if FAIL:** Screenshot of suspicious card + raw event data

---

## RESULTS TEMPLATE (Copy/Paste & Fill In)

```
=== CALL REVIEW TRANSCRIPT VERIFICATION RESULTS ===

Smoke Test: PASS / FAIL
  Console errors? YES / NO

0-turn call: PASS / FAIL
1–2 turn call: PASS / FAIL
50+ turn call: PASS / FAIL
  Modal-open time: ___ ms
Missing provenance call: PASS / FAIL
Empty speechResult call: PASS / FAIL
Transfer/multi-leg call: PASS / FAIL

DOM TRANSCRIPT headers count: ___

Truth integrity check: PASS / FAIL

Console errors (if any):
[paste top 20 lines or write "NONE"]

Performance issues (if any):
[describe or write "NONE"]

Screenshots (if failures):
[attach or write "NONE"]

Overall verdict: SHIP / DO NOT SHIP / FIX REQUIRED
```

---

## IF SOMETHING FAILS (No Drama)

### DOM headers > 1
→ I'll identify exact duplicate container and provide minimal deletion

### Console null/undefined errors
→ We patch exact access path (1-3 lines)

### Modal-open > 1s
→ Next sprint: virtualization or default collapse

### Transfer call looks wrong
→ Validate data model (turn identity keys)

### Fabricated provenance
→ Add explicit checks, show error instead

---

## GOVERNANCE CHECK (Run Once)

```bash
git show --name-only 58d067cd b6303422 eb957600 | grep -i "flow\|wiring\|tree"
# Expected output: (nothing)
```

**PASS:** No wiring changes outside Control Plane  
**FAIL:** Report any matches immediately

---

## SHIP CRITERIA (ALL Must Be TRUE)

```
✅ Smoke test: PASS (no console errors)
✅ All 6 edge cases: PASS (no crashes)
✅ DOM headers: 1 (no duplicates)
✅ Performance: < 1s (acceptable)
✅ Truth integrity: PASS (no fabrication)
✅ Governance: PASS (no wiring changes)
```

**If ALL pass:** ✅ SHIP IT

**If ANY fail:** ❌ DO NOT SHIP - paste results, we fix surgically

---

## CURRENT STATUS

| Check | Status |
|-------|--------|
| Code committed | ✅ Done (3 commits) |
| Null safety | ✅ Done (defensive checks) |
| Text handling | ✅ Done (trim + type check) |
| Runtime testing | ❌ **NOT DONE** |
| DOM verification | ❌ **NOT DONE** |
| Performance | ❌ **NOT DONE** |

**Action:** Run tests above, paste results template

---

**Testing time:** ~10-15 minutes  
**No excuses:** Required before ship  
**Questions:** Paste results, we'll fix what breaks
