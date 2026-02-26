# Agent2 Namespace Policy

## Decision

- Canonical storage namespace remains `aiAgentSettings.agent2`.
- Operator-facing UI labels may display normalized paths under `agent2.*`.

## Why

- Storage key stability prevents migration risk across runtime readers, audits, and historical data.
- Display normalization removes confusion without changing persisted schema.

## Enforcement

- Shared normalizer: `public/agent-console/lib/agent2PathNamespace.js`
- Call Console uses normalized display paths while preserving canonical link resolution.
- Regression tests: `tests/agent2PathNamespace.test.js`

## Rule for future changes

- Do not rename persisted `aiAgentSettings.agent2` keys unless a full migration plan exists:
  - dual-read/dual-write
  - backfill
  - cutover verification
  - rollback strategy
