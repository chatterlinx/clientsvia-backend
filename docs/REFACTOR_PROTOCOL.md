
# REFACTOR PROTOCOL v2.1 – FINAL PRODUCTION ENFORCEMENT EDITION

> **Purpose:**
> Mandatory refactor and deployment standards for the ClientsVia.ai multi-tenant AI agent platform.
> Guarantees **speed**, **accuracy**, **tenant isolation**, and **admin observability** across 100+ companies.
> Applies to all AI-generated and human-coded builds before merge or deploy.

---

## 🚨 MULTI-TENANT SAFETY

### Company ID Validation

* [ ] Exactly **one unique companyId** per tenant; never hardcode or script-insert IDs.
* [ ] Create tenants only through:

  * `POST /api/admin/data-center/companies`
  * `public/add-company.html`
* [ ] Every DB query filters by `companyId`.
* [ ] Middleware enforces tenant ownership.
* [ ] Verify:

  ```bash
  grep -r "companyId" routes/ services/ | grep -v "filter"
  ```

### Data Isolation Test

* [ ] Two-tenant test: no cross-data visibility.
* [ ] Wrong-company API calls must 403.
* [ ] All logs include `{ companyId }`.

---

## ⚙️ DATABASE LAYER – MONGOOSE + REDIS

### Mongoose

* [ ] Writes only via `.save()` or `findByIdAndUpdate()`.
* [ ] Use `markModified()` for nested objects.
* [ ] Add required indexes:

  ```js
  schema.index({ companyId:1, updatedAt:-1 });
  schema.index({ ts:1 }, { expireAfterSeconds:86400 }); // telemetry TTL
  ```

### Redis (Cache + Health)

* [ ] Always clear cache after save:

  ```js
  await company.save();
  await redisClient.del(`company:${companyId}`);
  ```
* [ ] TTLs: company 1h, session 30m.
* [ ] Read flow: Redis → Mongo → Redis → Return.
* [ ] Verify with grep:

  ```bash
  grep -A3 "\.save()" routes/ services/ | grep -B3 "redisClient.del"
  ```

---

## 🔔 NOTIFICATION CENTER INTEGRATION

### Required per Modal/Service

```js
const AdminNotificationService = require('../services/AdminNotificationService');
catch (error) {
  await AdminNotificationService.sendAlert({
    code:'AI_AGENT_ROUTING_FAILED',
    severity:'CRITICAL',
    companyId:company._id,
    message:error.message
  });
  throw error;
}
```

### Severity

| Level    | Meaning                     | Action         |
| -------- | --------------------------- | -------------- |
| CRITICAL | Down / data loss / security | SMS + email    |
| WARNING  | Degraded performance        | Slack alert    |
| INFO     | Recoverable event           | Dashboard only |

### Health Rules

* Non-blocking emission (fire-and-forget).
* Redis Streams/PubSub channel `notifications:events`.
* Dedup key: `notif:dedup:{companyID}:{feature}:{errorCode}` (TTL 60 s).
* Circuit breaker key: `notif:circuit:open` on lag or >5 % failures.
* Overhead ≤ 5 ms per call.

---

## 🧠 TENANT CONTEXT ENFORCEMENT

```js
const tenantContext = { companyID, requestId, feature, actor };
```

* Must propagate through all layers.
* No DB/Redis call without tenantContext.
* CI (`check-tenant-context.js`) blocks missing context.

---

## ⚡ PERFORMANCE SLOs

| Path              | p95 Max  |
| ----------------- | -------- |
| Read              | ≤ 250 ms |
| Write             | ≤ 500 ms |
| Modal Submit      | ≤ 600 ms |
| Notification Emit | ≤ 5 ms   |

PRs failing `check-slo.js` are rejected.

---

## 🧳 IDEMPOTENCY & SAFE RETRIES

* [ ] All POST/PUT endpoints require `Idempotency-Key` header.
* [ ] Server stores `idemp:{companyId}:{key}` TTL 5 min; duplicates short-circuit.

```js
const key = req.get('Idempotency-Key');
const seen = await redis.get(`idemp:${ctx.companyID}:${key}`);
if (seen) return res.json(JSON.parse(seen));
await redis.setEx(`idemp:${ctx.companyID}:${key}`,300,JSON.stringify(result));
```

---

## 🧩 FEATURE FLAGS & CANARY ROLLOUT

* [ ] New code behind `flags:{companyID}:{feature}`.
* [ ] Rollout 5 → 10 → 25 → 100 %.
* [ ] Admin dashboard shows per-flag error rate.

---

## 📈 LOGGING

* Use structured `logger.info/error`.
* Fields: `companyId, requestId, feature, module, event, durationMs, status`.
* `console.*` banned in prod (CI gate).
* Info sampling 10 %, Debug off.

---

## 🧪 TESTING

* CRUD + cache + notification tests.
* Modal unit test must confirm `sendAlert()` call.
* Performance test enforces p95 budgets.

---

## 🛡 SECURITY

* JWT auth for all routes.
* Admin → `requireRole('admin')`.
* Joi validation, rate limits, no raw user input in queries.

---

## 🧹 CLEANUP

* Delete diagnostics after use.
* No commented code or unused imports.
* `.env.example` contains only live keys with comments.
* `npm run dead` (knip + ts-prune) must show 0.

---

## 🧠 CHAOS & DR DRILLS

* Quarterly Redis outage → no user downtime; circuit opens.
* Quarterly Mongo primary kill → read-only mode; recover clean.
* Document rollback + cache purge process.

---

## 🧾 MIGRATIONS

* Every schema change adds `migration/[yyyymmdd]-<name>.md` (scope, up/down, rollback).
* Backfill runs per-tenant with logs.
* Tagged Redis invalidation: `cv:tags:company:{companyID}`.

---

## 🔍 SECRET & PII SCANNING

* CI runs gitleaks:

  ```yaml
  - run: npx gitleaks detect --no-banner --redact
  ```
* PRs blocked if secrets or raw PII in logs.

---

## 🔥 HOT-PATH RULES

* No outbound HTTP or heavy compute on request thread.
* Async queues only.
* ≤ 1 DB round-trip per read handler.

---

## ⚙️ AUTOMATION ENFORCEMENT

### Scripts in `/scripts`

* `check-notifications.js`
* `check-tenant-context.js`
* `check-hotpath.js`
* `check-slo.js`
* `dead.js` (knip + ts-prune wrapper)

### package.json

```json
{
  "scripts": {
    "check:notifications": "node scripts/check-notifications.js",
    "check:tenant-context": "node scripts/check-tenant-context.js",
    "check:hotpath": "node scripts/check-hotpath.js",
    "check:slo": "node scripts/check-slo.js",
    "security:secrets": "gitleaks detect --no-banner --redact",
    "dead": "knip && ts-prune"
  }
}
```

### CI Workflow

```yaml
- run: npm run check:notifications
- run: npm run check:tenant-context
- run: npm run check:hotpath
- run: npm run check:slo
- run: npm run security:secrets
- run: npm run dead
```

---

## ✅ FINAL SIGN-OFF

* [ ] All CI gates green.
* [ ] Tenant isolation verified.
* [ ] Cache + notifications working.
* [ ] Docs updated.
* [ ] Git tree clean & pushed.

---

## 🧯 ROLLBACK

```bash
git revert HEAD && git push
node scripts/clear-all-cache.js
node scripts/check-all-companies.js
```
Enhancement,Description,Implementation,Why It Helps
API Route Validation Script,Add a CI script to scan and test all defined routes.,"New /scripts/check-routes.js:
```js:disable-run",
Post-Deploy Smoke Tests,Automate endpoint health checks after Render deploys.,"Use Render's webhook + a tool like GitHub Actions or a cron job on a separate service.
Example cron script:
```bash
curl -f https://clientsvia-backend.onrender.com/api/admin/notifications/status",
Enhanced Logging for 404s,Log full request details for unmatched routes.,"In Express: Use morgan or custom middleware:
js<br>app.use((req, res, next) => {<br>  if (res.statusCode === 404) {<br>    logger.warn('404 Unmatched Route', { path: req.path, method: req.method, companyId: req.companyId, requestId: req.requestId });<br>    // Optional: Send WARNING alert via AdminNotificationService<br>  }<br>  next();<br>});<br>
Ban generic 404 pages; return JSON for API paths.","Makes errors traceable (e.g., grep logs by requestID). Builds on protocol's structured logging."
Route Documentation & Linting,Mandate route specs in code/docs.,"Add ESLint rule for route definitions (e.g., require JSDoc with @route GET /api/...).
Update migrations: Include route changes in .md files.
Use OpenAPI/Swagger for auto-gen docs: npm i swagger-jsdoc.","Prevents ""forgotten"" routes during refactors. Ties into cleanup (no unused routes)."
Monitoring Integration,Track 404 rates in production.,"Add to protocol's observability: Use Render Metrics or Datadog.
SLO Addition: `",404 Rate
Confirm alerts for affected tenants.

---

## 🚀 ADVANCED ENHANCEMENTS (Optional - Recommended for CI/CD)

### 1. API Route Validation Script
**Problem**: Routes defined but not registered (like today's adminNotifications bug)

**Solution**: Create `/scripts/check-routes.js`
```javascript
// Check all routes are registered in index.js
const fs = require('fs');
const path = require('path');

function findRouteFiles(dir) {
    const files = fs.readdirSync(dir);
    const routes = [];
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            routes.push(...findRouteFiles(fullPath));
        } else if (file.endsWith('.js')) {
            routes.push(fullPath);
        }
    }
    
    return routes;
}

// Get all route files
const routeFiles = findRouteFiles('./routes');

// Read index.js
const indexJS = fs.readFileSync('./index.js', 'utf-8');

// Check each route is registered
const unregistered = [];
for (const routeFile of routeFiles) {
    const basename = path.basename(routeFile, '.js');
    if (!indexJS.includes(basename) && !indexJS.includes(routeFile)) {
        unregistered.push(routeFile);
    }
}

if (unregistered.length > 0) {
    console.error('❌ UNREGISTERED ROUTES:', unregistered);
    process.exit(1);
}

console.log('✅ All routes registered');
```

**Add to package.json**:
```json
"scripts": {
    "check:routes": "node scripts/check-routes.js"
}
```

### 2. Post-Deploy Smoke Tests
**Problem**: Deploy succeeds but endpoints return 404

**Solution**: Create `/scripts/smoke-test.js`
```javascript
const endpoints = [
    '/api/admin/notifications/status',
    '/api/admin/data-center/summary',
    '/api/health'
];

async function smokeTest() {
    const baseURL = process.env.BASE_URL || 'https://clientsvia-backend.onrender.com';
    const token = process.env.ADMIN_TOKEN;
    
    for (const endpoint of endpoints) {
        const response = await fetch(`${baseURL}${endpoint}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        
        if (response.status === 404) {
            console.error(`❌ 404: ${endpoint}`);
            process.exit(1);
        }
        
        console.log(`✅ ${response.status}: ${endpoint}`);
    }
}

smokeTest();
```

**Run after deploy**:
```bash
npm run smoke-test
```

### 3. Enhanced 404 Logging
**Problem**: 404 errors are hard to debug without context

**Solution**: Add middleware in `index.js` (before error handler):
```javascript
// 404 Handler with detailed logging
app.use((req, res, next) => {
    if (!res.headersSent) {
        console.error('❌ [404 NOT FOUND]', {
            method: req.method,
            path: req.path,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            referer: req.get('referer'),
            timestamp: new Date().toISOString()
        });
        
        // Send structured JSON for API paths
        if (req.path.startsWith('/api')) {
            return res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.path,
                method: req.method,
                suggestion: 'Check API documentation'
            });
        }
        
        // HTML 404 for pages
        res.status(404).send('Page not found');
    }
});
```

### 4. Route Documentation Automation
**Problem**: Undocumented routes make refactoring dangerous

**Solution**: Use JSDoc + OpenAPI
```javascript
/**
 * @route GET /api/admin/notifications/status
 * @group Admin Notifications
 * @returns {object} 200 - Status object with alert counts
 * @returns {Error} 401 - Unauthorized
 * @security JWT
 */
router.get('/admin/notifications/status', authenticateJWT, requireRole('admin'), ...);
```

**Generate docs**:
```bash
npm i -D swagger-jsdoc swagger-ui-express
```

### 5. Production 404 Monitoring
**Problem**: Can't see route failures in production

**Solution**: Add metrics tracking
```javascript
// Track 404 rate
let notFoundCount = 0;
setInterval(() => {
    if (notFoundCount > 10) {
        // Send critical alert
        AdminNotificationService.sendAlert({
            code: 'HIGH_404_RATE',
            severity: 'WARNING',
            message: `High 404 rate: ${notFoundCount} in last minute`,
            details: 'Check for broken links or missing routes'
        });
    }
    notFoundCount = 0;
}, 60000); // Reset every minute

app.use((req, res, next) => {
    if (res.statusCode === 404) {
        notFoundCount++;
    }
    next();
});
```

**Add to Refactor Protocol SLOs**:
```
404 Error Rate: < 1% of requests
```

---

## 📋 UPDATED FINAL CHECKLIST

- [x] All routes registered in `index.js` (run `npm run check:routes`)
- [x] Smoke tests pass (run `npm run smoke-test`)
- [x] 404 handler logs structured errors
- [x] Critical routes documented with JSDoc
- [x] Production monitoring enabled for 404 rate

---

**Version:** 2.1
**Last Updated:** 2025-10-21
**Maintainer:** Engineering Director – ClientsVia.ai
**Mandatory for all AI Agent builds, refactors, and feature merges.**

---

## 🐛 CRITICAL DEPLOYMENT LESSONS (Learned Oct 21, 2025)

### Middleware Order Matters - 404 Handler Placement

**THE RULE**: The 404 handler MUST be the LAST middleware registered, AFTER all routes.

**WRONG** ❌ (Causes all requests to 404):
```javascript
// Global scope - executes before routes load
app.use((req, res) => { res.status(404).json(...) });

async function registerRoutes(routes) {
  app.use('/api/companies', routes.companiesRoutes);
  app.use('/api/admin', routes.adminRoutes);
  // Routes registered AFTER 404 handler - NEVER REACHED!
}
```

**CORRECT** ✅:
```javascript
async function registerRoutes(routes) {
  // 1. Register ALL routes first
  app.use('/api/companies', routes.companiesRoutes);
  app.use('/api/admin', routes.adminRoutes);
  // ... all other routes ...
  
  // 2. THEN register 404 handler (must be LAST in this function)
  app.use((req, res, next) => {
    if (!res.headersSent) {
      console.error('❌ [404 NOT FOUND]', { path: req.path, method: req.method });
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Endpoint not found' });
      }
      res.status(404).send('Page not found');
    }
  });
}
```

**Checklist**:
- [ ] 404 handler is INSIDE `registerRoutes()` function
- [ ] 404 handler is at the END of `registerRoutes()` (before closing `}`)
- [ ] NO 404 handler in global scope
- [ ] Error handler (with `err` param) comes AFTER 404 handler

---

### Frontend Class Method Dependencies

**THE RULE**: When building manager classes, ensure all helper methods exist BEFORE using them in child classes.

**PROBLEM**: `SettingsManager` calls `this.nc.apiPut()` and `this.nc.showToast()`, but `NotificationCenterManager` only had `apiGet()` and `apiPost()`.

**SOLUTION CHECKLIST**:
- [ ] List all methods parent class needs BEFORE coding child classes
- [ ] Common helpers needed in manager classes:
  - [ ] `apiGet(endpoint)` - GET requests
  - [ ] `apiPost(endpoint, data)` - POST requests
  - [ ] `apiPut(endpoint, data)` - PUT/PATCH requests
  - [ ] `apiDelete(endpoint)` - DELETE requests
  - [ ] `showToast(message, type)` - User feedback
  - [ ] `showError(message)` - Error alerts
  - [ ] `showSuccess(message)` - Success alerts
  - [ ] `showLoading()` / `hideLoading()` - Loading states
- [ ] Test parent class methods in console BEFORE building children

**EXAMPLE**:
```javascript
// Parent Manager (e.g., NotificationCenterManager, AIAgentSettingsManager)
class ParentManager {
    constructor() { this.token = localStorage.getItem('adminToken'); }
    
    // API Helpers (ALL METHODS)
    async apiGet(endpoint) { /* ... */ }
    async apiPost(endpoint, data) { /* ... */ }
    async apiPut(endpoint, data) { /* ... */ }
    async apiDelete(endpoint) { /* ... */ }
    
    // UI Helpers (ALL METHODS)
    showToast(message, type) { /* create toast DOM */ }
    showError(message) { this.showToast(message, 'error'); }
    showSuccess(message) { this.showToast(message, 'success'); }
    showLoading() { /* show overlay */ }
    hideLoading() { /* hide overlay */ }
}

// Child Manager
class ChildManager {
    constructor(parent) {
        this.parent = parent;
    }
    
    async save() {
        try {
            // Now ALL these methods exist!
            await this.parent.apiPut('/api/settings', data);
            this.parent.showSuccess('Saved!');
        } catch (error) {
            this.parent.showError('Failed!');
        }
    }
}
```

---

### Navigation Consistency Across All Pages

**THE RULE**: When adding a new top-level admin tab, add it to ALL admin pages, not just one.

**PROBLEM**: Notification Center tab was added to `index.html` but missing from `directory.html`, `add-company.html`, etc.

**SOLUTION CHECKLIST**:
- [ ] Identify ALL admin pages (use `ls public/admin-*.html public/{index,directory,add-company}.html`)
- [ ] Add navigation link to ALL pages
- [ ] Add CSS file reference (`<link rel="stylesheet" href="/css/notification-center.css">`)
- [ ] Add global monitor script if applicable (`<script src="/js/global-notification-tab-monitor.js">`)
- [ ] Test by navigating to EACH page and confirming tab appears

**AUTOMATED CHECK**:
```bash
# After adding a new tab, verify it exists in all admin pages
grep -l "admin-notification-center.html" public/*.html | wc -l
# Should equal total number of admin pages (e.g., 8)
```

**FILES TO UPDATE** (for any new top-level tab):
1. ✅ `public/index.html` (dashboard)
2. ✅ `public/directory.html`
3. ✅ `public/add-company.html`
4. ✅ `public/admin-data-center.html`
5. ✅ `public/admin-call-archives.html`
6. ✅ `public/v2global-trade-categories.html`
7. ✅ `public/admin-global-instant-responses.html`
8. ✅ Any other admin pages with shared navigation

---

### Pre-Deployment Smoke Test Protocol

**THE RULE**: ALWAYS run local tests BEFORE pushing to production.

**CHECKLIST BEFORE `git push`**:
```bash
# 1. Route Validation
npm run check:routes
# ✅ Must show: "All routes registered"

# 2. Local Server Test
npm start &
SERVER_PID=$!
sleep 5  # Wait for server to start

# 3. Critical Endpoint Tests
curl -f http://localhost:3000/api/health || echo "❌ Health check failed"
curl -f http://localhost:3000/index.html || echo "❌ Dashboard failed"
curl -f http://localhost:3000/api/companies -H "Authorization: Bearer $ADMIN_TOKEN" || echo "⚠️ Companies endpoint failed (expected 401 without token)"

# 4. Frontend Load Test (check console for errors)
open http://localhost:3000/admin-notification-center.html
# Manually check browser console for errors

# 5. Kill test server
kill $SERVER_PID

# 6. If ALL PASS, then push
git push
```

**AUTOMATION**: Add to `package.json`:
```json
{
  "scripts": {
    "pre-deploy": "npm run check:routes && npm run smoke-test"
  }
}
```

Then before pushing:
```bash
npm run pre-deploy && git push
```

---

## 📋 UPDATED PRE-PUSH CHECKLIST (Enhanced)

Run this BEFORE every `git push`:

```bash
# 1. Code Quality
npm run check:routes          # ✅ All routes registered
# npm run lint                 # (if ESLint configured)

# 2. Database Safety
grep -r "hardcoded.*companyId" routes/ services/  # ❌ Must return empty
grep -A3 "\.save()" routes/ services/ | grep -B3 "redisClient.del"  # ✅ Cache invalidation after saves

# 3. Multi-Tenant Safety
grep -r "companyId" routes/ | grep -v "req.params.companyId" | grep -v "req.user.companyId"  # Check for unsafe usage

# 4. API Completeness (for manager classes)
# If building a new manager class, ensure parent has:
# apiGet, apiPost, apiPut, apiDelete, showToast, showError, showSuccess

# 5. Navigation Consistency (if adding new tab)
# Check tab appears in all admin pages:
grep -l "your-new-tab.html" public/*.html | wc -l  # Should match admin page count

# 6. Git Status
git status  # ✅ Ensure all files committed
git log --oneline -1  # ✅ Review last commit message

# 7. THEN PUSH
git push
```

---

✅ This version now includes:

* Idempotency + safe retries
* TenantContext build guard
* Notification dedup + circuit breaker
* Feature flags + canary rollout
* Secret scanning and chaos tests
* Automated dead-code + hot-path CI gates
* **Route validation + smoke tests** (NEW)
* **Enhanced 404 logging** (NEW)
* **Middleware order enforcement** (NEW - Oct 21, 2025)
* **Frontend class method dependencies** (NEW - Oct 21, 2025)
* **Navigation consistency checks** (NEW - Oct 21, 2025)
* **Pre-deployment smoke test protocol** (NEW - Oct 21, 2025)

