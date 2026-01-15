## Prompt Pack Versioning

### Purpose
Prompt packs are versioned, trade-scoped default prompt sets.
They are only used when explicitly selected per company.

### Key Schema
All prompt keys follow:
`booking.{tradeKey}.{flow}.{step}`

Examples:
- `booking.hvac.service.non_urgent_consent`
- `booking.plumbing.service.urgent_triage_question`
- `booking.universal.guardrails.missing_prompt_fallback`

### Trade Scope Rules
- `tradeKey` is required for pack selection and keys.
- `universal` is a first-class trade key.
- Packs are never applied globally.

### Pack Selection
Stored per company:
`aiAgentSettings.frontDeskBehavior.promptPacks.selectedByTrade.{tradeKey}`

### Versioning
Pack ids are versioned:
`{trade}_v1`, `{trade}_v2`, etc.

Rules:
- A pack upgrade changes only the selected pack id.
- No tenant overrides are overwritten.
- History entries must be recorded on every upgrade.

### Overrides
Overrides live in:
`aiAgentSettings.frontDeskBehavior.bookingPromptsMap`

Rules:
- Overrides always win over pack defaults.
- Pack upgrades must not overwrite overrides.

### Guardrails
`promptGuards.missingPromptFallbackKey` must be set and visible.
Missing prompt keys should be tracked in debug snapshot.

### Audit Requirements
Each upgrade must append:
`promptPacks.history[]` with:
- `tradeKey`
- `fromPack`
- `toPack`
- `changedAt`
- `changedBy`
- `notes`

### Rollback
Rollback is a pack selection flip:
`selectedByTrade.{tradeKey} = {trade}_vX`
Confirm with `previewUpgrade` that diff is empty after rollback.
