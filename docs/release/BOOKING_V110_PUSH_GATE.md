# V110 Booking System Push Gate Checklist

**Version:** V110  
**Created:** 2026-02-07  
**Purpose:** Enterprise-grade release gate for Slot Registry + Discovery/Booking Flows

---

## ⚠️ TESTING REALITY NOTE (2026-02-07)

**Automated test suite currently failing due to pre-existing issues; therefore staging requires raw-event validation as the release gate.**

Pre-existing test failures (not introduced by V110):
- Missing `chai` module: `tests/pricing-policy.test.js`, `tests/enterprise-variables.test.js`
- Missing `mongodb-memory-server`: `tests/call-center-load.test.js`
- Incorrect module path `../app`: `tests/multi-tenant-isolation.test.js`
- Schema version mismatch v1→v2: `tests/platformSnapshot.contract.test.js`
- Missing `Customer.getOrCreatePlaceholder`: `tests/customer-lookup-race.test.js`

**Until CI is green, the following policy applies:**
- Staging push allowed with raw-event gate verification
- Production push requires explicit sign-off note in PR/commit confirming raw-event pass

---

## ⛔ AUTOMATIC REJECTION CONDITIONS

Do NOT push if ANY of these are true:
- Git repo is not clean
- Tests have NEW failures introduced by this change
- Raw events show gate-generated prompts
- `GATE_SPOKE_VIOLATION` appears in any test call
- `ADDRESS_BREAKDOWN_*` actions appear anywhere
- **If `npm test` is red for pre-existing reasons, staging must pass raw-event gate AND production push requires an explicit sign-off note in the PR/commit**

---

## 0) Non-Negotiable: Wiring Truth

All wiring changes must be applied through the **Control Plane Wiring tab flow tree** so the Wiring tab + raw events stay the JSON truth.

**No side-wiring in code "because it works."**

---

## 1) Freeze Scope + Clean Repo

```bash
git status
```

**Expected:** Only V110-related files should be modified:
- `config/controlPlaneContract.frontDesk.v1.json`
- `config/onboarding/DefaultFrontDeskPreset.js`
- `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`
- `routes/company/runtimeTruth.js`
- `routes/v2twilio.js`
- `services/engine/booking/BookingFlowRunner.js`
- `services/engine/StepEngine.js` (new file)
- `services/wiring/companySeeder.js`
- `services/wiring/wiringRegistry.v2.js`

If anything unrelated is modified/untracked, remove or stash it.

---

## 2) Run the Local Proof Pack

```bash
npm run lint
npm test
```

### Lint Requirements
- **No new errors** in V110 files
- Pre-existing warnings in other files are acceptable

### Test Requirements
- **No new test failures** introduced by V110 changes
- Pre-existing failures (documented):
  - `chai` module missing (tests/pricing-policy.test.js, tests/enterprise-variables.test.js)
  - `mongodb-memory-server` missing (tests/call-center-load.test.js)
  - `../app` module path incorrect (tests/multi-tenant-isolation.test.js)
  - Schema version mismatch v1→v2 (tests/platformSnapshot.contract.test.js)

---

## 3) Static Invariant Verification

### A) Gate Must Not Emit Text

Search for banned patterns in gate code paths:

```bash
# Should NOT find these in gate logic (booking gate sections of v2twilio.js):
grep -n "responsePreview\|reply:\|say:\|speech\|gatherPrompt" routes/v2twilio.js | grep -i gate
```

**Acceptable matches:** Only logging/tracing code, never prompt generation.

### B) ADDRESS_BREAKDOWN Must Be Banned

```bash
# Should return ONLY the violation detection code, not any action assignments:
grep -n "ADDRESS_BREAKDOWN" routes/v2twilio.js services/engine/booking/BookingFlowRunner.js
```

**Expected:** Only violation detection lines (contains `includes('ADDRESS_BREAKDOWN')` or comments).

### C) Gate Violation Must Be Fail-Closed

Verify in `routes/v2twilio.js` that `GATE_SPOKE_VIOLATION` detection:
1. Clears `bookingResult.reply = null`
2. Sets `bookingResult.action = 'ESCALATE'`
3. Sets `bookingResult.requiresTransfer = true`
4. Logs `resolution: 'FAIL_CLOSED'`

**Logging-only is NOT acceptable.**

---

## 4) Commit Like a Grownup

```bash
git add -A
git commit -m "V110: Slot registry + discovery/booking flows; gate-speak invariant; prompt tracing

- Add slotRegistry, discoveryFlow, bookingFlow, policies to frontDeskBehavior
- Implement fail-closed GATE_SPOKE_VIOLATION invariant
- Add prompt source tracing (promptSource, stepId, slotId, slotSubStep)
- Remove ADDRESS_BREAKDOWN_* actions
- Update runtimeTruth with V110 sections
- Add Discovery Flow tab to Front Desk UI"
```

---

## 5) Push to STAGING First

```bash
git push origin HEAD:staging
```

Deploy staging, then run **ONE** end-to-end booking call.

**STAGING is allowed** if:
- Repo is clean with only V110 files
- Gate invariant is fail-closed in both locations
- Static ban checks pass
- Wiring truth shows V110 nodes

**MAIN/PROD is BLOCKED** until:
- Raw events pass the binary acceptance test below
- Either CI is fixed OR explicit sign-off note added to commit/PR

### Raw Events Acceptance Test (Binary)

#### ✅ MUST SEE:
- `BOOKING_GATE_ROUTED` with **NO** prompt text fields
- `BOOKING_RUNNER_PROMPT` containing:
  - `promptSource` (e.g., `booking.step:b1`)
  - `stepId` (e.g., `b1`, `b2`, `b3`)
  - `slotId` (e.g., `name.first`, `phone`, `address.full`)
  - `slotSubStep` (nullable, e.g., `street`, `city`, `unit`)

#### ❌ MUST NOT SEE:
- Any gate event containing prompt text (`responsePreview`, `reply`, etc.)
- Any `ADDRESS_BREAKDOWN_*` action
- Any `GATE_SPOKE_VIOLATION` event

**If any ❌ appears even once → fix, recommit, repeat staging.**

---

## 6) Merge to Main + Push Prod

Only after step 5 passes completely:

```bash
git checkout main
git merge --no-ff staging
git push origin main
```

---

## Runtime Truth Verification

After deployment, hit runtime truth endpoint for test company and verify:

```bash
curl -s "https://your-api/api/company/COMPANY_ID/runtime-truth" | jq '.frontDesk'
```

**Must show:**
- `slotRegistry.configured: true`
- `slotRegistry.slotCount: 5` (or configured count)
- `discoveryFlow.configured: true`
- `discoveryFlow.stepsCount: 2` (or configured count)
- `bookingFlow.configured: true`
- `bookingFlow.stepsCount: 4` (or configured count)
- `flowPolicies.configured: true`

---

## Backward Compatibility

The `companySeeder.js` automatically seeds V110 defaults for companies missing:
- `frontDeskBehavior.slotRegistry`
- `frontDeskBehavior.discoveryFlow`
- `frontDeskBehavior.bookingFlow`
- `frontDeskBehavior.policies`

No manual migration required for existing companies.

---

## Future CI Integration (Recommended)

Add to CI pipeline:
1. **Test gate:** `npm test` must pass (or match known failures)
2. **Grep gate:** Fail if gate contains banned prompt strings
3. **Schema validation:** Ensure contract file is valid JSON

---

## Contact

For V110 architecture questions, refer to:
- `/docs/release/BOOKING_V110_PUSH_GATE.md` (this file)
- `/services/engine/StepEngine.js` (unified step engine)
- `/config/controlPlaneContract.frontDesk.v1.json` (schema contract)
