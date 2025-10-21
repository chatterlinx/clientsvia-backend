# REFACTOR PROTOCOL - DO NOT DEPLOY WITHOUT THIS

> **PURPOSE**: This is your final checklist before declaring any feature "done". Paste this at the end of every build session. Go through it line by line. This prevents catastrophic mistakes like duplicate company IDs, missing cache invalidation, untested notification triggers, and architectural drift.

---

## 🚨 CRITICAL: Multi-Tenant Safety (CHECK FIRST)

### Company ID Validation
- [ ] **ONLY ONE COMPANY ID per company** - Never create companies via scripts with hardcoded IDs
- [ ] **Company creation ONLY through**:
  - `POST /api/admin/data-center/companies` (production)
  - `public/add-company.html` UI (production)
  - MongoDB auto-generates `_id` - NEVER manually assign
- [ ] **Every database query filters by `companyId`** - No global queries that leak between tenants
- [ ] **Middleware validates `companyId` ownership** - User can only access their company's data
- [ ] **Search for hardcoded IDs in code**:
  ```bash
  grep -r "68e3f77a9d623b8058c700c4" --exclude-dir=node_modules .
  grep -r "new ObjectId(" routes/ services/ --exclude="*.test.js"
  ```
- [ ] **Verify collection names** - All models point to correct V2 collections (no legacy)

### Data Isolation Check
- [ ] Test: Create two companies, verify Company A cannot see Company B's data
- [ ] Test: Try to access another company's data via API with wrong `companyId` - should fail
- [ ] Verify: All API responses include `companyId` in logs for audit trail

---

## 💾 Mongoose + Redis Architecture (ALWAYS BOTH)

### Mongoose (Primary Database)
- [ ] **All writes go to MongoDB first** via `Company.findByIdAndUpdate()`, `company.save()`, etc.
- [ ] **Schema includes all new fields** - Check `models/v2Company.js`, `models/v2User.js`, etc.
- [ ] **Use `company.markModified('nested.path')` for nested objects** - Critical for Mongoose to detect changes
- [ ] **Validate schema changes don't break existing data** - Test with production company document

### Redis (Cache Layer)
- [ ] **ALWAYS clear Redis cache after Mongoose save**:
  ```javascript
  await company.save();
  await redisClient.del(`company:${companyId}`); // REQUIRED
  ```
- [ ] **Cache key format**: `company:${companyId}`, `session:${sessionId}`, `user:${userId}`
- [ ] **TTL set appropriately**: 3600s (1hr) for companies, 1800s (30min) for sessions
- [ ] **Read flow**: Check Redis → Miss → Load from MongoDB → Save to Redis → Return
- [ ] **Search for saves without cache clear**:
  ```bash
  grep -A3 "\.save()" routes/ services/ | grep -B3 "redisClient.del" | wc -l
  # Should match number of save() calls
  ```

### Schema Versioning
- [ ] **Old schema keys handled in migration layer** - See `routes/admin/callFiltering.js` for example
- [ ] **New saves use ONLY new schema** - Purge old keys on save
- [ ] **Document schema changes** in model file header (70+ line comment like spam filter)

---

## 🔔 Notification Center Integration (NEW FEATURES)

### Every Feature Must Register Alerts
- [ ] **Import AdminNotificationService** in relevant files:
  ```javascript
  const AdminNotificationService = require('../services/AdminNotificationService');
  ```
- [ ] **Add alert triggers for failures**:
  ```javascript
  catch (error) {
      await AdminNotificationService.sendAlert({
          code: 'FEATURE_NAME_FAILURE',
          severity: 'CRITICAL', // or 'WARNING', 'INFO'
          companyId: company._id,
          companyName: company.companyName,
          message: 'Brief description of what failed',
          details: error.message
      });
      throw error; // Re-throw to preserve error flow
  }
  ```
- [ ] **Alert codes are DESCRIPTIVE** - e.g., `TWILIO_GREETING_FALLBACK`, `AI_AGENT_ROUTING_FAILED`, `REDIS_CACHE_MISS_CRITICAL`
- [ ] **Severity levels are accurate**:
  - `CRITICAL`: System down, data loss, security breach
  - `WARNING`: Degraded performance, fallback triggered, retryable error
  - `INFO`: Notable events, successful recoveries
- [ ] **Auto-registration verified** - Code automatically appears in Notification Center → Registry tab
- [ ] **Test alert delivery** - Trigger error and verify SMS/email sent to admins

### Notification System Health
- [ ] **Twilio credentials configured** in Notification Center → Settings
- [ ] **Admin contacts added** with phone numbers
- [ ] **Webhook configured** in Twilio dashboard: `https://clientsvia-backend.onrender.com/api/twilio/sms`

---

## 🏗️ Architecture & File Organization

### Folder Structure Enforcement
- [ ] **Routes**: `routes/admin/*.js` (admin-only), `routes/company/*.js` (company-scoped), `routes/v2*.js` (top-level)
- [ ] **Services**: `services/*.js` (business logic), `services/knowledge/*.js` (AI-specific)
- [ ] **Models**: `models/v2*.js` (Mongoose schemas), `models/knowledge/*.js` (knowledge-specific)
- [ ] **Frontend**: `public/*.html`, `public/js/[feature-name]/*.js`, `public/css/*.css`
- [ ] **No files in wrong locations** - No services in routes, no business logic in models
- [ ] **No "utils" dumping ground** - Split into focused modules

### Naming Conventions
- [ ] **Files**: kebab-case (`ai-agent-settings.js`, `notification-center.html`)
- [ ] **Classes**: PascalCase (`AdminNotificationService`, `CallArchivesManager`)
- [ ] **Functions**: camelCase verbs (`loadSettings`, `validateCredentials`, `sendAlert`)
- [ ] **No abbreviations**: No "misc", "temp", "old", "backup-v2", "final-final"
- [ ] **Descriptive names**: `spam-filter-manager.js` not `sfm.js`

### Module Boundaries
- [ ] **No circular dependencies** - Check with `madge` or manual inspection
- [ ] **Services don't import from routes** - Only downward dependencies
- [ ] **Models are pure schemas** - No business logic in Mongoose models
- [ ] **One responsibility per file** - Max 500 lines; split if larger

---

## 🧪 Testing & Validation

### Manual Testing Checklist
- [ ] **Test with REAL company** from production database (not hardcoded test company)
- [ ] **Test full CRUD cycle**: Create → Read → Update → Delete
- [ ] **Test with browser console open** (F12) - Zero JavaScript errors
- [ ] **Test with Render logs open** - Zero backend errors
- [ ] **Test multi-tenant isolation** - Create 2nd company, verify data separation
- [ ] **Test error scenarios** - Disconnect internet, invalid input, missing fields
- [ ] **Test notification triggers** - Force errors and verify alerts sent

### Automated Tests
- [ ] **Run existing tests**: `npm test` - All tests pass
- [ ] **Add test for new feature** if it's mission-critical (auth, payments, multi-tenant)
- [ ] **Script-based tests** in `scripts/` for complex validations

### Linting & Code Quality
- [ ] **Run linter**: `npm run lint` - Zero errors
- [ ] **Fix auto-fixable issues**: `npm run lint:fix`
- [ ] **Search for TODOs**: `grep -r "TODO\|FIXME" --exclude-dir=node_modules --exclude-dir=docs .` - Zero found
- [ ] **Search for console.log without context**:
  ```bash
  grep -r "console.log" routes/ services/ utils/ middleware/ | grep -v "\[" | grep -v "CHECKPOINT"
  # Should be zero results
  ```

---

## 📊 Logging & Debugging

### Checkpoint System
- [ ] **Every major function has checkpoints**:
  ```javascript
  console.log('🔍 [SERVICE_NAME] CHECKPOINT 1: Starting operation');
  console.log('📊 [SERVICE_NAME] CHECKPOINT 2: Loaded data:', data);
  console.log('✅ [SERVICE_NAME] CHECKPOINT 3: Operation successful');
  ```
- [ ] **Emoji prefixes used**:
  - 🔍 Debug/trace
  - ✅ Success
  - ❌ Error
  - 📊 Data load
  - 🔔 Notification
  - 💾 Database operation
  - 🔑 Auth/security
- [ ] **Never mask errors** - Per user memory #8912579, ALWAYS log full error stack

### Error Handling
- [ ] **Errors include context**: `companyId`, `userId`, operation name
- [ ] **Errors logged before throwing**:
  ```javascript
  catch (error) {
      console.error('❌ [SERVICE_NAME] Operation failed:', {
          companyId,
          error: error.message,
          stack: error.stack
      });
      throw error; // Re-throw to preserve flow
  }
  ```
- [ ] **No silent catches** - Every catch block must log or trigger notification

---

## 🗂️ Database & Schema

### Mongoose Schema Updates
- [ ] **All new fields added to model** - Check `models/v2Company.js`, `models/v2User.js`, etc.
- [ ] **Default values set** for optional fields
- [ ] **Indexes added** for frequently queried fields:
  ```javascript
  { companyId: 1, createdAt: -1 } // Compound index for tenant + time queries
  ```
- [ ] **Schema documented** with 50+ line header explaining structure (see `v2Company.js` spam filter)

### Legacy Data Cleanup
- [ ] **No references to old collections** - Search for `companies`, `contacts`, `tradecategories` (lowercase)
- [ ] **V2 collections used everywhere**:
  - `companiesCollection` (NOT `companies`)
  - `contactsV2` (NOT `contacts`)
  - `enterpriseTradeCategories` (NOT `tradecategories`)
- [ ] **Verify with script**:
  ```bash
  node scripts/check-collections.js
  # Should only show V2 collections
  ```

---

## 🎨 Frontend Integration

### API Endpoint Matching
- [ ] **Frontend URLs match backend routes exactly**:
  ```javascript
  // Frontend:
  fetch('/api/admin/notifications/settings')
  // Backend:
  router.get('/admin/notifications/settings', ...)
  ```
- [ ] **HTTP methods match** (GET, POST, PUT, DELETE)
- [ ] **Request payloads match expected schema** - Check Joi validators

### UI/UX Standards
- [ ] **Toast notifications for user feedback** (not `alert()`)
- [ ] **Loading states shown** during async operations
- [ ] **Error messages are user-friendly** (not raw error stack)
- [ ] **Forms validate before submit** (required fields, format checks)
- [ ] **Success messages confirm operation** ("Settings saved successfully")

### Tab Integration
- [ ] **New tabs added to navigation** in `public/index.html`
- [ ] **Tab colors set** if applicable (green, orange, red, etc.)
- [ ] **Dynamic tab monitor updated** if needed (e.g., Notification Center badge)

---

## 🔐 Security & Authentication

### Authentication Checks
- [ ] **All routes protected** with `authenticateJWT` middleware
- [ ] **Admin routes use** `requireRole('admin')` middleware
- [ ] **Company routes validate** user belongs to company:
  ```javascript
  const { companyId } = req.params;
  if (req.user.companyId && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({ error: 'Unauthorized' });
  }
  ```

### Input Validation
- [ ] **All inputs validated** with Joi schemas (`lib/joi.js`)
- [ ] **No raw user input in queries** - Always sanitize/escape
- [ ] **Rate limiting applied** to public endpoints (`middleware/rateLimit.js`)

---

## 📝 Documentation Updates

### Code Documentation
- [ ] **Model files have header comments** (50+ lines explaining structure)
- [ ] **Service files have header comments** explaining purpose, usage, related files
- [ ] **Complex logic has inline comments** explaining "why" not "what"

### Architecture Documentation
- [ ] **Update `docs/CLIENTSVIA-COMPLETE-ARCHITECTURE.md`** if new system added
- [ ] **Update `docs/CALL-FLOW-ARCHITECTURE.md`** if call flow changed
- [ ] **Update `docs/ADMIN-DASHBOARD-TABS-GUIDE.md`** if new tab added
- [ ] **Create `docs/[FEATURE]-ARCHITECTURE.md`** for new major features (e.g., `NOTIFICATION-CENTER-ARCHITECTURE.md`)

### README Updates
- [ ] **Top-level `README.md` reflects current state**
- [ ] **Setup instructions updated** if new env vars or dependencies added
- [ ] **`.env.example` updated** with new required variables

---

## 🧹 Cleanup & Dead Code Removal

### File Cleanup
- [ ] **Delete diagnostic scripts used only for debugging**:
  ```bash
  ls scripts/ | grep -E "(test-|check-|diagnose-|find-|nuke-)"
  # Review and delete one-off scripts
  ```
- [ ] **Delete commented-out code** - If needed later, it's in Git history
- [ ] **Remove unused imports** at top of files
- [ ] **Remove unused functions** - Search for unused exports

### Environment Variables
- [ ] **Remove unused env vars** from `.env.example`
- [ ] **Document all env vars** with comments:
  ```env
  # MongoDB connection string (production)
  MONGODB_URI=mongodb+srv://...
  
  # Redis connection (for caching)
  REDIS_URL=redis://...
  ```

### Git Cleanliness
- [ ] **No `.only` in tests** - Would skip other tests
- [ ] **No debug breakpoints** - Remove `debugger;` statements
- [ ] **No large binary files** - Use `.gitignore` properly

---

## 🚀 Deployment Checklist

### Pre-Push Validation
```bash
# Run this exact sequence before git push
npm run lint && \
grep -r "TODO\|FIXME" --exclude-dir=node_modules --exclude-dir=docs . && \
grep -r "console.log" routes/ services/ middleware/ | grep -v "\[" && \
git status
```

### Git Workflow
- [ ] **Commit message is descriptive**: "Add Twilio credentials UI to Notification Center Settings"
- [ ] **One feature per commit** - Atomic commits
- [ ] **Run `git status`** - Verify working tree clean
- [ ] **Run `git push`** - Deploy to production
- [ ] **Check Render logs** after deploy - Verify no startup errors

### Post-Deploy Verification
- [ ] **Test in production** - Navigate to new feature in live site
- [ ] **Check Render logs** for errors during first use
- [ ] **Verify database updates** persisted correctly
- [ ] **Verify Redis cache** is being used (check response times)
- [ ] **Verify notifications work** in production (test alert trigger)

---

## 🎯 Feature-Specific Checklists

### For Admin Dashboard Tabs
- [ ] Navigation link added to `public/index.html`
- [ ] HTML file created: `public/admin-[tab-name].html`
- [ ] CSS file created: `public/css/[tab-name].css`
- [ ] JS manager created: `public/js/[tab-name]/[Feature]Manager.js`
- [ ] Backend routes created: `routes/admin/[tab-name].js`
- [ ] Routes registered in `app.js`
- [ ] Tab documented in `docs/ADMIN-DASHBOARD-TABS-GUIDE.md`

### For Company Profile Features
- [ ] Sub-tab button added to `public/company-profile.html`
- [ ] Content section added with unique ID
- [ ] Manager class handles load/save
- [ ] Backend endpoint returns company-specific data (filtered by `companyId`)
- [ ] Settings saved to Mongoose + Redis cache cleared
- [ ] Notification triggers added for failures

### For AI Agent Features
- [ ] Settings saved to `company.aiAgentLogic` nested object
- [ ] Cache cleared: `redisClient.del(\`company:\${companyId}\`)`
- [ ] Knowledge sources registered in appropriate collection
- [ ] Thresholds validated (0.0 - 1.0 range)
- [ ] Fallback behavior tested
- [ ] Analytics tracking added

### For Twilio/Voice Features
- [ ] Webhook route created: `router.post('/api/twilio/[endpoint]', ...)`
- [ ] Twilio signature validation added (security)
- [ ] Company identified by incoming phone number
- [ ] Call logged to `v2AIAgentCallLog` collection
- [ ] ElevenLabs TTS integration tested
- [ ] Fallback alerts configured
- [ ] Call recording stored (if enabled)

---

## 🔥 Common Mistakes to Avoid

### ❌ NEVER DO THIS
1. **Hardcode company IDs in code** - Always use variables
2. **Create companies via scripts** - Use production UI only
3. **Save to Mongoose without clearing Redis** - Always clear cache
4. **Use old collection names** (`companies`, `contacts`) - Use V2 names
5. **Query without filtering by `companyId`** - Always filter for multi-tenant
6. **Use `alert()` for user feedback** - Use toast notifications
7. **Mask console errors** - Always log full error details
8. **Leave TODO/FIXME in code** - Finish or create GitHub issue
9. **Deploy without testing** - Always test locally first
10. **Forget to document** - Update docs as you build

---

## ✅ Final Sign-Off

**Before marking feature as "DONE", confirm:**

- [ ] I ran the pre-push validation script - Zero errors
- [ ] I tested in browser with F12 console - Zero errors
- [ ] I tested multi-tenant isolation - Companies can't see each other's data
- [ ] I verified Mongoose + Redis working together - Cache cleared after saves
- [ ] I added notification triggers - Alerts sent on failures
- [ ] I updated architecture docs - Feature is documented
- [ ] I cleaned up diagnostic scripts - No orphaned test files
- [ ] I verified production deployment - Feature works live
- [ ] Working tree is clean - `git status` shows nothing to commit
- [ ] Changes are pushed - `git push` completed successfully

---

## 📞 Emergency Rollback Plan

If something breaks in production:

1. **Check Render logs** - Identify error
2. **Revert last commit**:
   ```bash
   git revert HEAD
   git push
   ```
3. **Clear Redis cache**:
   ```bash
   node scripts/clear-all-cache.js
   ```
4. **Verify database integrity**:
   ```bash
   node scripts/check-all-companies.js
   ```
5. **Send admin notification** via Notification Center

---

**SAVE THIS FILE. PASTE THIS AT THE END OF EVERY BUILD. GO LINE BY LINE. DO NOT SKIP.**

**Last Updated**: 2025-10-21
**Version**: 1.0
**Next Review**: After every major feature milestone

