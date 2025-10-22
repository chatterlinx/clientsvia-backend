# Notification Contract — Canonical Adapter

Adapter (single source of truth)
- Name: AdminNotificationService.sendAlert
- Import: services/AdminNotificationService.js
- Callers: all tabs and services must use this adapter only

Event Schema (authoritative)

type: object
required: [code, severity, message]
properties:
  code:        { type: string }                             # <TAB>_<MODULE>_<ACTION>_<CAUSE>
  severity:    { type: string, enum: [CRITICAL, WARNING, INFO] }
  message:     { type: string }                             # short, no PII
  companyId:   { type: [string, null] }                     # required for tenant-scoped paths
  companyName: { type: [string, null] }
  requestId:   { type: [string, null] }                     # x-request-id preferred
  feature:     { type: [string, null] }                     # product area e.g. notification-center, data-center
  tab:         { type: [string, null] }                     # UI tab key e.g. NOTIFICATION_CENTER
  module:      { type: [string, null] }                     # sub-component e.g. SETTINGS, REGISTRY
  eventType:   { type: [string, null], enum: [failure, slo_breach, important_event, null] }
  meta:        { type: [object, null] }                     # key/value only (ids, counts, timings)
  ts:          { type: [number, null] }                     # epoch ms
  latencyMs:   { type: [number, null] }                     # required for slo_breach
  details:     { type: [string, null] }                     # optional free text
  stackTrace:  { type: [string, null] }                     # optional

Error code naming
- Format: <TAB>_<MODULE>_<ACTION>_<CAUSE> (UPPER_SNAKE)
- Examples:
  - NOTIF_SETTINGS_SAVE_TWILIO_UNAUTHORIZED
  - DATACENTER_COMPANY_LOAD_TIMEOUT
  - AIBRAIN_KB_SYNC_RETRY_EXHAUSTED

Severity policy
- CRITICAL (SEV1): outage, data loss, security
- WARNING  (SEV2): user-blocking error, degraded core path
- INFO     (SEV3/4): notable event or recovery

Routing rules (adapter behavior)
- Fire-and-forget (non-blocking)
- Dedup window: 60s on {companyId, tab, module, code}
- Circuit breaker on queue lag or send failures; do not block user path
- Escalation: CRITICAL/WARNING follow Settings intervals (SMS/email); INFO is dashboard-only

SLO emission
- eventType: slo_breach
- latencyMs must be set
- code: SLO_<TAB>_<MODULE>_<OP>_P95

Tenant requirements
- Any tenant-scoped emit must provide companyId
- Platform-wide events may set companyId=null and companyName="Platform-Wide"

Backward compatibility
- Existing fields (code, severity, message, details, stackTrace) remain supported
- New fields are optional but recommended for full registry and health views
