# 🗺️ ANALYTICS LEGACY MAP

**Purpose:** Document all analytics-related files found during cleanup  
**Date:** November 15, 2025  
**Status:** Phase 1 Discovery Complete  

---

## 📊 CLASSIFICATION SYSTEM

| Type | Description | Action |
|------|-------------|--------|
| **CALL_ANALYTICS** | Modern call analytics (AI Agent Settings → Analytics tab) | ✅ KEEP |
| **GATEWAY_HEALTH** | Legacy AI Gateway health/performance monitoring | 🗑️ REMOVE |
| **CONTACT_ANALYTICS** | Lead scoring & contact management analytics | 📦 KEEP (separate concern) |
| **AICORE_ANALYTICS** | Optional AiCore-specific analytics | 🔄 REVIEW |

---

## 📁 FILE INVENTORY

### ✅ **CALL_ANALYTICS** (Keep - Canonical System)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `routes/company/v2aiAnalytics.js` | 450 | **CANONICAL** API endpoints for call analytics | ✅ KEEP |
| `public/js/ai-agent-settings/AnalyticsManager.js` | 758 | **CANONICAL** Frontend analytics UI | ✅ KEEP |
| `docs/ANALYTICS-DASHBOARD-COMPLETE.md` | 475 | Documentation for call analytics | ✅ KEEP |

**Dependencies:**
- Reads from: `v2AIAgentCallLog`, `v2Company`
- No dependencies on AI Gateway or AnalyticsEngine
- Clean, isolated system ✨

---

### 🗑️ **GATEWAY_HEALTH** (Remove/Quarantine - Legacy Cruft)

#### Backend Services

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `services/aiGateway/AnalyticsEngine.js` | 355 | Response time trends, uptime stats, P50/P95/P99 for OpenAI/MongoDB/Redis | 🗑️ DELETE |
| `services/aiGateway/HealthMonitor.js` | ~400 | Health monitoring for AI Gateway services | 🗑️ DELETE |
| `services/aiGateway/AlertEngine.js` | ~300 | Alert rules for gateway health | 🗑️ DELETE |
| `services/aiGateway/CostTracker.js` | ~250 | LLM cost tracking | 🗑️ DELETE |
| `services/aiGateway/LLMAnalyzer.js` | ~400 | LLM response analysis | 🗑️ DELETE |
| `services/aiGateway/SuggestionApplier.js` | ~350 | Auto-apply suggestions | 🗑️ DELETE |
| `services/aiGateway/CallLogProcessor.js` | ~300 | Process AI Gateway call logs | 🗑️ DELETE |
| `services/aiGateway/DiagnosticEngine.js` | ~200 | Diagnostic tools | 🗑️ DELETE |
| `services/aiGateway/index.js` | 50 | Service aggregator | 🗑️ DELETE |

#### Backend Models

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `models/aiGateway/HealthLog.js` | ~150 | Store gateway health checks | 🗑️ DELETE |
| `models/aiGateway/CallLog.js` | ~200 | Store gateway call logs | 🗑️ DELETE |
| `models/aiGateway/Suggestion.js` | ~150 | Store AI suggestions | 🗑️ DELETE |
| `models/aiGateway/CostLog.js` | ~100 | Store LLM costs | 🗑️ DELETE |
| `models/aiGateway/AlertRule.js` | ~100 | Alert rule definitions | 🗑️ DELETE |
| `models/aiGateway/index.js` | 50 | Model aggregator | 🗑️ DELETE |

#### Backend Routes

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `routes/admin/aiGateway.js` | 1256 | **MOUNTED** AI Gateway admin API (`/api/admin/ai-gateway/*`) | 🗑️ DELETE |

**Endpoints exposed (all legacy):**
- `GET /api/admin/ai-gateway/health/openai`
- `GET /api/admin/ai-gateway/health/mongodb`
- `GET /api/admin/ai-gateway/health/redis`
- `GET /api/admin/ai-gateway/health/all`
- `GET /api/admin/ai-gateway/suggestions`
- `POST /api/admin/ai-gateway/suggestions/:id/apply`
- `GET /api/admin/ai-gateway/call-logs`
- `GET /api/admin/ai-gateway/statistics`
- Many more...

#### Frontend

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `public/js/ai-gateway/AIGatewayManager.js` | 729 | Main UI controller for AI Gateway | 🗑️ DELETE |
| `public/js/ai-gateway/HealthModal.js` | ~300 | Health check modal | 🗑️ DELETE |
| `public/js/ai-gateway/HealthReportModal.js` | ~250 | Health report modal | 🗑️ DELETE |
| `public/js/ai-gateway/index.js` | ~50 | Frontend aggregator | 🗑️ DELETE |

#### HTML Pages

| File | Purpose | Action |
|------|---------|--------|
| `public/admin-global-instant-responses.html` | Contains AI Gateway UI elements | 🔄 REVIEW (may have other uses) |

**Route Mounting (index.js):**
```javascript
Line 210: routes.aiGatewayRoutes = await loadRouteWithTimeout('./routes/admin/aiGateway', 'aiGatewayRoutes');
Line 426: app.use('/api/admin/ai-gateway', routes.aiGatewayRoutes);
```
**Action:** ❌ REMOVE these lines

---

### 📦 **CONTACT_ANALYTICS** (Keep - Separate Concern)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `utils/contactAnalytics.js` | 252 | Lead scoring, contact priority, action recommendations | ✅ KEEP |

**Functions:**
- `calculateLeadScore()` - Lead scoring algorithm
- `getContactPriority()` - Priority classification
- `generateContactInsights()` - Interaction patterns
- `getRecommendedActions()` - Action recommendations
- `generateCompanyContactAnalytics()` - Company-level contact stats

**Used By:** Contact management system (separate from call analytics)  
**Action:** Keep as-is - no conflict with call analytics

---

## 📊 SUMMARY STATISTICS

| Category | Files | Action |
|----------|-------|--------|
| **CALL_ANALYTICS** (Keep) | 3 | ✅ No changes needed |
| **GATEWAY_HEALTH** (Delete) | 23 | 🗑️ Delete all |
| **CONTACT_ANALYTICS** (Keep) | 1 | ✅ No changes needed |
| **TOTAL** | 27 | - |

---

## 🎯 ACTION PLAN

### Immediate Actions

1. **Delete AI Gateway Directory**
   - `services/aiGateway/` (entire directory - 9 files)
   - `models/aiGateway/` (entire directory - 6 files)
   - `public/js/ai-gateway/` (entire directory - 4 files)

2. **Delete AI Gateway Routes**
   - `routes/admin/aiGateway.js` (1256 lines)

3. **Remove Route Mounts in index.js**
   - Line 210: Remove `routes.aiGatewayRoutes` loading
   - Line 426: Remove `app.use('/api/admin/ai-gateway', ...)` mounting

4. **Clean Up HTML**
   - Review `public/admin-global-instant-responses.html` for AI Gateway UI elements
   - Remove any references to `AIGatewayManager`

---

## ⚠️ RISK ASSESSMENT

### Low Risk (Safe to Delete)

✅ AI Gateway is **completely separate** from call analytics  
✅ No dependencies between AI Gateway and v2aiAnalytics.js  
✅ No shared models or services  
✅ Different UI paths (admin-global-instant-responses vs company-profile)  

### Zero Breaking Changes

The canonical call analytics system (`v2aiAnalytics.js` + `AnalyticsManager.js`) has:
- ✅ No imports from `services/aiGateway/*`
- ✅ No references to `AnalyticsEngine`
- ✅ No dependency on AI Gateway routes
- ✅ Completely isolated data source (`v2AIAgentCallLog`)

---

## 🚀 NEXT STEPS

1. ✅ **Phase 1 Complete:** Discovery and mapping done
2. ⏭️ **Phase 2:** Lock canonical call analytics (verify dependencies)
3. ⏭️ **Phase 3:** Delete AI Gateway files
4. ⏭️ **Phase 4:** Align analytics with Brain/Cheat Sheet
5. ⏭️ **Phase 5:** Clean up legacy docs
6. ⏭️ **Phase 6:** Sanity tests

---

## 📝 NOTES

- **AI Gateway was a monitoring/suggestion system for LLM health** - completely different from call analytics
- **contactAnalytics.js is for lead scoring** - separate concern, no conflict
- **Call analytics is clean and isolated** - no refactoring needed before deletion
- **Zero risk of breaking call analytics** - systems are independent

---

**Audit By:** AI Assistant  
**Audit Date:** November 15, 2025  
**Status:** Ready for Phase 2

