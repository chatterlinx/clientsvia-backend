## Prompt Pack Migration Playbook

Use this when legacy prompt keys need migration to:
`booking.{tradeKey}.{flow}.{step}`.

### Preconditions
- Migration map is deterministic and versioned (no regex magic).
- Preview path is read-only and does not mutate company data.

### 1) Preview (Read-Only)
Run:
`GET /api/admin/prompt-packs/migration/preview?companyId=...`

Expected output:
- `legacyKeysFound` list.
- `proposedMappings` list.
- `conflicts` list (must be empty to apply).
- `unmappedLegacyKeys` list (must be reviewed).
- `migrationStatus` remains `not_started` or `previewed`.

Failure conditions:
- Conflicts present → stop, do not apply.
- Unmapped legacy keys present → update migration map before applying.

### 2) Apply (Explicit Only)
Run:
`POST /api/admin/prompt-packs/migration/apply`

Rules:
- Do not overwrite any new-schema keys.
- Copy legacy text into new key only if new key is empty.
- Do not delete legacy keys.
- Track status in `promptPacks.migration`.

### 3) Post-Apply Checks
From wiring report and debug snapshot:
- `promptPacks.legacyKeysRemaining` is 0.
- `promptPacks.migration.status` is `applied`.
- `promptPacks.migration.conflictsCount` is 0.
- `promptPacks.migration.migratedKeysCount` > 0 (if legacy keys existed).

### Rollback Strategy
Migration is additive only; rollback is not required.
If a mistake occurs:
- Remove newly copied keys explicitly.
- Do not delete legacy keys unless approved.

### Operator Notes
- Never apply to production without preview.
- Penguin and other production tenants require explicit, audited apply.
