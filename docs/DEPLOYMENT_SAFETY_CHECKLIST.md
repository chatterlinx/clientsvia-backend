## Deployment safety checklist (Control Plane / Runtime turnover)

### Golden rules
- **No hidden runtime defaults**: if config is missing, runtime-truth must show it as missing (not invented).
- **Company-scoped only**: all behavior is per `companyId` and must not bleed across trades.
- **Feature-flag first**: new behavior must ship “dark” until explicitly enabled.

### Before deploy
- **Verify git**: `main` is clean and pushed.
- **Verify runtime-truth** for target company:
  - `GET /api/company/:companyId/runtime-truth`
  - Health is **GREEN/YELLOW**, not RED.
  - Templates/scenarios are loaded (non-zero).
  - Booking is configured (slots present) if booking is enabled.
- **If enabling Booking Contract V2**:
  - Confirm `aiAgentSettings.frontDeskBehavior.bookingContractV2Enabled === true`
  - Confirm `slotLibraryCount > 0` and `slotGroupsCount > 0`
  - Confirm runtime-truth `booking.bookingContractV2.compiledPreview.activeSlotIdsOrdered.length > 0`
  - Confirm there are **no** `missingSlotRefs`.

### Canary rollout (recommended)
- Enable the flag for **1 company** first.
- Run a real call test for:
  - Residential path (no special flags)
  - Commercial path (set flags via Dynamic Flow set_flag)
  - Transfer path
  - After-hours path
- Watch logs for:
  - `[BOOKING ENGINE] ✅ Using Booking Contract V2 (compiled to legacy slots)`
  - Any `NOT_CONFIGURED` booking source warnings

### Rollback plan
- Turn off `bookingContractV2Enabled` for the company (instant rollback; no deploy required).
- If needed, revert `main` to a known-good commit and redeploy.


