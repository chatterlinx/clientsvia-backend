# CI Guards — Required Checks

Tenant context gate
- Fail if any DB/Redis call is made without companyId on tenant routes

Single adapter gate
- Forbid direct Twilio/email/webhook sends for alerts outside AdminNotificationService
- Grep denylist: twilio.messages.create, sendgrid.send, axios/fetch to alert endpoints in src/

Emit contract gate
- Static check on AdminNotificationService.sendAlert calls:
  - Must include: code, severity, message
  - code must match <TAB>_<MODULE>_<ACTION>_<CAUSE>
  - Recommend presence of companyId (tenant flows), feature, tab, module
  - slo_breach must include latencyMs

Registry coverage gate
- Every sendAlert(code=...) must have a matching registry id <TAB>.<MODULE>.<ACTION>
- Fail if mismatch or missing

SLO gate
- Per-tab perf tests; budgets:
  - Read p95 ≤ 250ms
  - Write p95 ≤ 500ms
  - Submit p95 ≤ 600ms
- Tabs with exceptions must declare them here with justification

Dead code gate
- knip + ts-prune must report zero actionable items

Secret/PII scan
- gitleaks detect --no-banner --redact

Bundle guard
- Block PR if JS/CSS grows >5% over baseline without an approved note

Legacy reference guard (temporary for migrations)
- Fail PR if legacy emitters are referenced after consolidation
