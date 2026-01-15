## Pack Upgrade Playbook

Use this checklist for any pack upgrade `{trade}_vX` → `{trade}_vY`.

### Preconditions
- CompanyId is correct.
- Trade key is correct.
- Migration is not required for this company (legacy keys = 0).

### 1) Wiring / Snapshot Sanity
From Wiring tab or debug snapshot:
- Confirm `companyId` matches target.
- Confirm `tradeKey` matches target.
- `promptPacks.selectedByTrade.{tradeKey} === "{trade}_vY"`.
- `promptPacks.migration.migrationStatus` is `not_started` or `previewed` (not `applied` when migration is a no-op).
- `promptPacks.legacyKeysRemaining === 0`.
- `promptGuards.missingPromptFallbackKey` is set.
- No repeated `missingPromptKeys` during normal booking flow.

Failure conditions:
- Any mismatch above → stop. Fix configuration before proceeding.

### 2) Pack Diff Check
Run:
`previewUpgrade(companyId, tradeKey, toPack="{trade}_vY")`.

Expected after apply:
- `fromPack === "{trade}_vY"`.
- `toPack === "{trade}_vY"`.
- `changedKeys.length === 0`.
- `newKeys.length === 0`.
- `removedKeys.length === 0`.

Failure conditions:
- Any diff remains → the company is not actually on `{trade}_vY` or config drift exists.

### 3) History Entry
Verify `aiAgentSettings.frontDeskBehavior.promptPacks.history[]` contains:
- `tradeKey = "{tradeKey}"`
- `fromPack = "{trade}_vX"`
- `toPack = "{trade}_vY"`
- `changedAt` set
- `changedBy` non-empty
- `notes` non-empty

Failure conditions:
- Missing history entry → audit trail broken. Fix before declaring upgrade complete.

### 4) Test Console Behavioral Smoke Test
Run scripted prompts that hit upgraded flows.

Checklist:
- Wording matches `{trade}_vY` prompts.
- Consent gating still enforced.
- `promptGuards.missingPromptKeys` remains empty.
- Response source shows pack prompts (not fallback).

### 5) Live Call Sanity (Optional)
Run a staged or internal call for the trade:
- Confirm `{trade}_vY` wording is spoken.
- Confirm no fallback guardrails triggered.

### Rollback Strategy
Rollback is safe and deterministic:
- Set `promptPacks.selectedByTrade.{tradeKey}` back to `{trade}_vX`.
- Confirm `previewUpgrade` shows no diff.
- No overrides are modified during rollback.

### Operator Notes
- Never apply a pack upgrade without a clean preview.
- Never overwrite tenant overrides.
- Always log `changedBy` and `notes` for audit.
