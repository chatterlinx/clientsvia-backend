# REFACTOR PROTOCOL v2.2 — FINAL PRODUCTION ENFORCEMENT

Purpose
Mandatory standards for ClientsVia.ai’s multi-tenant AI agent platform. Guarantees speed, accuracy, tenant isolation, and admin observability across 100+ companies. Applies to all AI- or human-written code before merge/deploy.

---

## 0) CANONICAL NOTIFICATION ADAPTER — SINGLE SOURCE OF TRUTH

Adapter
AdminNotificationService.sendAlert (services/AdminNotificationService.js)

Authoritative event schema

* Required: code, severity, message
* Recommended: companyId, companyName
* Optional: requestId, feature, tab, module, eventType (failure|slo_breach|important_event), meta (obj), ts, latencyMs, details, stackTrace

Error code naming <TAB>*<MODULE>*<ACTION>_<CAUSE> (UPPER_SNAKE)

Routing rules

* Fire-and-forget, non-blocking
* Dedup 60s on {companyId, tab, module, code}
* Circuit breaker on lag/error; never block user paths
* CRITICAL/WARNING escalate via SMS/email; INFO is dashboard-only

SLO events

* eventType: slo_breach, include latencyMs
* code pattern: SLO_<TAB>*<MODULE>*<OP>_P95

Forbidden
Any direct Twilio/email/webhook alert outside AdminNotificationService. Migrate to the adapter.

---

## 1) MULTI-TENANT SAFETY

Company ID

* One unique companyId per tenant; never hardcode/script insert
* Tenant creation only via POST /api/admin/data-center/companies or public/add-company.html

Queries & middleware

* Every DB/Redis query filters by companyId
* Middleware enforces tenant ownership (403 on mismatch)

Isolation tests

* Two-tenant visibility test passes
* Wrong-company API calls return 403
* All logs include companyId

---

## 2) DATA LAYER — MONGOOSE + REDIS

Mongoose

* Writes via .save() / findByIdAndUpdate()
* markModified() for nested paths
* Indexes:

  * { companyId:1, updatedAt:-1 }
  * { ts:1 }, { expireAfterSeconds:86400 } for telemetry

Redis (cache + health)

* After every write: redisClient.del(`company:${companyId}`)
* TTLs: company 1h, session 30m
* Read flow: Redis → Mongo → Redis → Return

---

## 3) TENANT CONTEXT ENFORCEMENT

tenantContext = { companyId, requestId, feature, actor }

* Must propagate route → service → data → infra
* No DB/Redis call without tenantContext (CI gate)

---

## 4) PERFORMANCE SLOs

p95 budgets

* Read ≤ 250 ms
* Write ≤ 500 ms
* Submit (modal) ≤ 600 ms
* Notification emit ≤ 5 ms

Breaches emit slo_breach with latencyMs and a SLO_* code.

---

## 5) IDEMPOTENCY & SAFE RETRIES

* All POST/PUT require Idempotency-Key header
* Store idemp:{companyId}:{key} (TTL 5m); short-circuit duplicates
* Retries must be idempotent; never double-charge or double-save

---

## 6) FEATURE FLAGS & CANARY

* New code behind flags:{companyId}:{feature}
* Rollout 5 → 10 → 25 → 100%
* Dashboard shows per-flag error rate

---

## 7) LOGGING

* Structured logs only (no console.* in prod)
* Fields: companyId, requestId, feature, module, event, durationMs, status
* INFO sampled 10%, DEBUG off in prod

---

## 8) NOTIFICATION CENTER — REGISTRY & HEARTBEATS

Registry (confirmation list)

* Every emit site must be registered with:
  id = <TAB>.<MODULE>.<ACTION>
  tab, module, feature, locations [file:line / route], errorCodes[], severityPolicy, owner, notes
* Auto-registration via AdminNotificationService (code serves as the key)

Heartbeats

* Each registry entry defines a normal-path heartbeat emit (eventType: important_event) after successful operations
* Dedup via {companyId, tab, module, code} 60s

Health rules

* A registry point is green when: seen OK in last 24h, tenant context valid, settings complete, escalation responsive
* “Validate All” runs backend checks and marks Valid/Invalid

---

## 9) HOT-PATH RULES

* No outbound HTTP or heavy compute on request thread
* Use queues/async jobs
* ≤ 1 DB round-trip per read handler
* Notification emits never block

---

## 10) TESTING

* CRUD + cache + notification unit tests
* Each critical path test asserts sendAlert() fires on failure
* Perf tests enforce p95 budgets (k6/autocannon)

---

## 11) SECURITY

* JWT on all routes; requireRole('admin') on admin
* Joi validation + rate limits
* No raw user input in queries

---

## 12) CLEANUP

* Delete diagnostics after use
* No commented code or unused imports
* .env.example includes only live keys with comments
* Dead-code scan must be 0

---

## 13) CHAOS & DR DRILLS

* Quarterly Redis outage drill → circuit opens, no downtime
* Quarterly Mongo primary kill → read-only mode, clean recovery
* Document rollback + cache purge

---

## 14) MIGRATIONS

* Each schema change: migration/[yyyymmdd]-<name>.md (scope, up/down, rollback)
* Backfills per-tenant with logs
* Tagged Redis invalidation: cv:tags:company:{companyId}

---

## 15) SECRET & PII SCANNING

* gitleaks in CI with redact; PR blocked on hits

---

## 16) ENFORCEMENT (CI + scripts)

Scripts (/scripts)

* check-notifications.js (single-adapter + registry coverage)
* check-tenant-context.js
* check-hotpath.js
* check-slo.js
* dead.js (knip + ts-prune)
* check-routes.js (optional: route inventory & 404 watch)

package.json (commands)

* check:notifications, check:tenant-context, check:hotpath, check:slo, security:secrets, dead

CI workflow (order)

* run check:tenant-context
* run check:notifications (single adapter; contract; registry coverage)
* run check:hotpath
* run check:slo
* run security:secrets
* run dead
* bundle guard: fail if JS/CSS grows >5% without approved note
* legacy guard: fail on direct Twilio/email/webhook sends in src/

---

## 17) COMPANY TABS — INVENTORY & REFACTOR LOOP

Tabs (per company)
Overview, Configuration, Notes, AI Voice Settings, AI Agent Settings, AI Performance, Spam Filter
(Each may contain subtabs; managers per subtab.)

Tab Matrix (maintained JSON)

* tab_key, display_name, subtab_keys, manager_files, routes (GET/PUT/POST/DELETE), models, redis keys/TTLs, external deps

Per-tab Emit Registry (JSON)

* id, tab, module, feature:"company", locations, errorCodes[], severityPolicy, owner, notes
* Include heartbeat code for OK path; list NON_CANONICAL sends to migrate

Default code taxonomy

* OVERVIEW: OVERVIEW_LOAD_DB_ERROR, OVERVIEW_METRICS_FETCH_TIMEOUT
* CONFIGURATION: CONFIGURATION_NUMBERS_SAVE_VALIDATION_FAILED, CONFIGURATION_HOURS_SAVE_INVALID_RANGE, CONFIGURATION_ROUTING_UPDATE_TWILIO_4XX, CONFIGURATION_BILLING_UPDATE_PROVIDER_ERROR
* NOTES: NOTES_CREATE_VALIDATION_FAILED, NOTES_SAVE_DB_ERROR
* AI_VOICE_SETTINGS: AI_VOICE_TTS_CONFIG_SAVE_FAILED, AI_VOICE_STT_PROVIDER_AUTH_FAILED, AI_VOICE_FLOW_PUBLISH_TWILIO_ERROR
* AI_AGENT_SETTINGS: AI_AGENT_INTENTS_SAVE_VALIDATION_FAILED, AI_AGENT_KNOWLEDGE_SYNC_FAILED, AI_AGENT_THRESHOLD_OUT_OF_RANGE
* AI_PERFORMANCE: AI_PERFORMANCE_ANALYTICS_FETCH_TIMEOUT, AI_PERFORMANCE_LATENCY_P95_BREACH (slo_breach)
* SPAM_FILTER: SPAM_FILTER_RULES_SAVE_VALIDATION_FAILED, SPAM_FILTER_BLACKLIST_IMPORT_FORMAT_ERROR, SPAM_FILTER_HEURISTICS_ENGINE_ERROR

Severity defaults

* Provider/DB hard failure → WARNING
* Data loss/security → CRITICAL
* SLO breach → INFO (escalate if repeated)

---

## 18) PER-TAB KICKOFF (COPY THIS PER TAB)

Deliver

1. Normalize folder/managers; single responsibility per file
2. Enforce tenantContext on every DB/Redis call
3. Wrap async ops in error boundaries
4. Wire sendAlert() at all failure/retry/circuit/SLO points with required context
5. Add slo_breach emits for any budget breach (include latencyMs)
6. Cache discipline: clear Redis post-write; verify keys/TTLs
7. Update Emit Registry JSON; include heartbeat codes; flag NON_CANONICAL sends
8. PASS/FAIL table: tenant-context, cache, emit coverage, SLO plan, dead-code, linter/tests, docs
9. Canary: 5 tenants → 10% → 25% → 100% with rollback notes

---

## 19) SLO TEST PLAN TEMPLATE (PER TAB)

* Endpoints under test: reads/writes/submits (list)
* Method: k6/autocannon 150 req/route; record p50/p95
* Budgets: Read ≤250ms | Write ≤500ms | Submit ≤600ms
* Exceptions: justify and document
* Emit on breach: eventType=slo_breach, code <TAB>*<MODULE>*<OP>_P95, include latencyMs

---

## 20) APPROVAL GATES (PR MUST PASS)

* NOTIFICATION_CONTRACT.md present + referenced
* Tab Matrix JSON updated
* Per-tab Emit Registry JSON updated (with heartbeat)
* Single-adapter / contract / registry-coverage gates pass
* Tenant-context gate pass
* SLO test plan present; perf gate green
* Dead-code, hot-path, secrets gates green
* Docs updated (tab README + registry delta)
* Git tree clean & pushed

---

## 21) ROLLBACK

* git revert HEAD && git push
* node scripts/clear-all-cache.js
* node scripts/check-all-companies.js
* Confirm alerts for affected tenants (Notification Center)

---

## 22) OWNER QUICK CHECK (30-SECOND REVIEW)

* Single adapter only?
* Registry shows all entries green?
* Any CRITICAL/WARNING spikes?
* SLO p95s inside budget?
* Tenant isolation test passes?
* Cache clears verified post-write?
* No console.* in prod; logs structured?
* Canary stage progressing?

---

## 23) OPTIONAL HARDENING

* Post-deploy smoke (status endpoints)
* 404 monitor with structured warn logs + optional WARNING sendAlert
* Route documentation (JSDoc/OpenAPI) + linter rule for @route tags

---

# EXECUTION PROMPTS (READY TO USE)

A) Tab Matrix
Scan company UI + managers and fill the Tab Matrix JSON for: Overview, Configuration, Notes, AI Voice Settings, AI Agent Settings, AI Performance, Spam Filter. Include subtabs, manager files, routes, models, redis keys/TTLs, external deps. Output JSON only.

B) Registry (per tab)
For tab <TAB_KEY>, output Emit Registry JSON (id/tab/module/feature/locations/errorCodes/severityPolicy/owner/notes) with heartbeat codes. Flag NON_CANONICAL sends.

C) SLO plan (per tab)
Define SLO test plan for <TAB_KEY> (routes, method, budgets, exceptions, breach emit code). Output concise YAML-like plan.

D) Guards

* Single-adapter scan: list direct Twilio/email/webhook sends to migrate
* Registry-coverage map: list MISSING_IN_REGISTRY and MISSING_IN_CODE
* Tenant-context scan: DB/Redis calls lacking companyId context

E) Subtab one-liner
Subtab <SUBTAB_KEY> of <TAB_KEY> — deliver registry entries (fail + heartbeat) with file:line and routes, SLO plan, NON_CANONICAL migration list, tenantContext + cache invalidation gap list. Output JSON + short plan.
