## Pack Trace Verification Walkthrough

### Location
`docs/pack-management/pack-trace-walkthrough.md`

### Purpose
Validate the Pack Trace panel accurately reflects runtime truth during Test Console execution after a pack upgrade, per companyId and trade.

---

## Section 1 — Preconditions

Before verifying, ensure:

- Tenant has a selected pack for the target trade.
  - Example: `selectedByTrade.hvac = "hvac_v2"`
- Migration status is `not_started` or `previewed` (no-op case).
- Legacy contamination is `0`.
- No pending upgrade diff for the current pack.

If any are false, fix wiring first.

---

## Section 2 — Controls & Signals

The Pack Trace panel must show:

- **trade** (string)
- **pack** (string)
- **overrides** (int)
- **fallback** (int)
- **missing** (int)
- **guards** (`clean` | `firing` | `blocked`)

No extra fields. No verbose logs. No implementation leakage.

---

## Section 3 — Expected Behavior Matrix

Run the following inputs in Test Console (Pack Test Mode ON):

| Scenario                       | Trigger Input                             | Expected Result                                                                                 |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **S1: Non-Urgent HVAC**        | “My AC is blowing warm but still running” | `trade=hvac`, `pack=hvac_v2`, `overrides=0`, `fallback=0`, `missing=0`, `guards=clean`          |
| **S2: HVAC Urgent**            | “My AC stopped cooling completely”        | same as above                                                                                   |
| **S3: Consent Clarify**        | “Maybe”                                   | same as above + confirm consent gating in transcript                                            |
| **S4: Off-Trade**              | “My sink is clogged”                      | `trade=plumbing` (if available) OR `trade=null` (if no pack selected), must NOT reuse hvac pack |
| **S5: Random**                 | “Are you open tomorrow?”                  | Should route to universal/knowledge and Pack Trace must NOT claim hvac                          |
| **S6: Missing-Key Simulation** | Temporarily remove one pack prompt        | `missing > 0` AND `guards=firing` AND call does not crash                                       |

---

## Section 4 — Failure Definitions

A failure occurs if any of the following happen:

- **False Attribution:** Pack Trace shows `hvac_v2` for non-HVAC scenario
- **Silent Missing:** `missing > 0` and `guards ≠ firing`
- **Silent Fallback:** fallback increments without Pack Trace showing it
- **Override Misreport:** actual override exists but `overrides=0`
- **Mismatch vs. debugSnapshot:** Pack Trace does not match snapshot truth

---

## Section 5 — Cross-Verification Logic

During any scenario, compare:

- Pack Trace panel
- `debugSnapshot.promptPacks`
- `v22BlackBox.promptPacks`
- Booking flow transcript (consent → slot)

These four must agree on:

- active trade
- active pack
- override count
- fallback count
- missing count
- guard state

If not, there is an issue with:

- Pack Trace panel adapter
- prompt resolver telemetry
- fallback guardrail plumbing
- or trade triage selection

---

## Section 6 — Operator Sign-Off

A trade/tenant can be considered **verified** only when:

- [ ] Upgrade preview diffs are clean
- [ ] History entry written
- [ ] Legacy = 0
- [ ] Pack Trace matches runtime truth across S1–S6
- [ ] No false attribution
- [ ] No silent fallback
- [ ] No silent missing
- [ ] Guards behave deterministically
- [ ] One Test Console transcript archived to ticket/system

When these are true, that trade for that tenant is **production safe**.
