# Refactor + Notification Rollup

Canonical adapter
- AdminNotificationService.sendAlert (services/AdminNotificationService.js)

Current event schema (extended)
- Required: code, severity, message
- Recommended: companyId, companyName
- Optional: requestId, feature, tab, module, eventType, meta, ts, latencyMs, details, stackTrace

Gaps vs standard
- Missing fields in some call sites: requestId, feature, tab, module, eventType, meta, ts, latencyMs
- Action: add gradually during tab refactors

Tabs (initial list, from UI)
- NOTIFICATION_CENTER (Dashboard, Registry, Logs, Settings)
- Add the rest once exported from navbar/tab scan

SLO defaults
- Read p95 ≤ 250ms, Write p95 ≤ 500ms, Submit p95 ≤ 600ms
- Known exception candidate: NOTIFICATION_CENTER health-check → move heavy work async

Registry counts (current snapshot)
- NOTIFICATION_CENTER: 9 planned entries (codes present in routes/admin/adminNotifications.js); 0% validated until emits flow

Top risks
- Legacy direct sends bypassing adapter
- Missing requestId propagation for tracing
- Over-eager retries causing alert noise

Mitigations
- Single-adapter CI guard
- Registry coverage gate
- Dedup window 60s and severity-based escalation settings

Next tabs to refactor (highest impact first)
1) AI Agent Runtime (external deps + error volume)
2) Twilio Webhooks and Voice flows (critical paths)
3) Data Center (heavy reads/writes)

Rollback
- Re-enable any deprecated emitters temporarily if adapter path fails
- Keep registry/log schemas backward compatible during transition
