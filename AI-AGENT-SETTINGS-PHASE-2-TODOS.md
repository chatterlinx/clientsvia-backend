# AI AGENT SETTINGS - PHASE 2: COMPLETE TODO CHECKLIST

**Start Date:** October 13, 2025  
**Estimated Duration:** 5-6 days (40-50 hours)  
**Status:** Not Started

---

## 📊 **PROGRESS OVERVIEW**

```
Total Tasks: 33
Completed: 0
In Progress: 0
Remaining: 33
Progress: 0%
```

---

## 🏗️ **BUILD PHASES**

### **PHASE 1: SECURITY FOUNDATIONS** (Day 1 - 4 hours)

#### ✅ Security Middleware
- [ ] **Task 1.1:** Create `middleware/configSecurity.js`
  - RBAC check: `ensureCompanyScope('company:config:write')`
  - Company ownership verification
  - Export middleware function
  - **Files:** `middleware/configSecurity.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 1.2:** Add rate limiting middleware
  - Install `express-rate-limit` if not present
  - Configure: 30 requests/minute per user
  - Apply to all config mutation endpoints
  - **Files:** `middleware/configSecurity.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 1.3:** Implement log redaction
  - Create utility function to redact sensitive data
  - Redact variable values, phone numbers, emails in logs
  - Only log full data at DEBUG level
  - **Files:** `utils/logRedaction.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 1.4:** Add IP & User-Agent capture
  - Extract IP from `req.ip` or `X-Forwarded-For`
  - Extract User-Agent from headers
  - Store in audit logs
  - **Files:** Update `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 1.5:** Apply security middleware to routes
  - Import and apply to all config endpoints
  - Test with Postman/curl
  - **Files:** `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 1 hour

---

### **PHASE 2: READINESS GATE** (Day 2 - 4 hours)

#### ✅ Backend Logic

- [ ] **Task 2.1:** Create ConfigurationReadinessService
  - Create `services/ConfigurationReadinessService.js`
  - Implement `calculateReadiness(company)` function
  - Return score (0-100), blockers, warnings
  - **Files:** `services/ConfigurationReadinessService.js`
  - **Estimated Time:** 2 hours
  - **Logic:**
    ```javascript
    score = (variablesComplete * 45%) + 
            (fillerWordsActive * 10%) + 
            (scenariosActive * 25%) + 
            (voiceConfigured * 10%) + 
            (testCallsMade * 10%)
    ```

- [ ] **Task 2.2:** Add readiness tracking to schema
  - Update `models/v2Company.js`
  - Add `configuration.readiness` object
  - Fields: lastCalculatedAt, score, canGoLive, components, isLive, goLiveAt, goLiveBy
  - **Files:** `models/v2Company.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 2.3:** Build readiness API endpoint
  - Create `GET /api/company/:id/configuration/readiness`
  - Call ConfigurationReadinessService
  - Add Redis caching (30 second TTL)
  - Return readiness object with deep-link fix targets
  - **Files:** `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 2.4:** Test readiness calculation
  - Test with company missing variables
  - Test with complete configuration
  - Verify score calculation accuracy
  - **Estimated Time:** 30 minutes

#### ✅ Frontend UI

- [ ] **Task 2.5:** Update status banner
  - Modify `AIAgentSettingsManager.js`
  - Call readiness endpoint on load
  - Display real score and percentage
  - Show blockers summary
  - Update progress bar width
  - **Files:** `public/js/ai-agent-settings/AIAgentSettingsManager.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 2.6:** Add Go Live button
  - Add button to top-right of AI Agent Settings tab
  - Disable if `canGoLive === false`
  - Show tooltip with blockers on hover
  - Wire onclick to `goLive()` function
  - **Files:** `public/company-profile.html`, `AIAgentSettingsManager.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 2.7:** Build blockers list UI
  - Create expandable blockers section
  - Show icon, title, detail, impact for each blocker
  - Add "Fix Now" button with deep-link navigation
  - Color-code by severity (critical=red, major=orange, warning=yellow)
  - **Files:** `public/company-profile.html`, `AIAgentSettingsManager.js`
  - **Estimated Time:** 1.5 hours

---

### **PHASE 3: PREVIEW BEFORE APPLY** (Day 3 - 6 hours)

#### ✅ Backend Logic

- [ ] **Task 3.1:** Build secure preview token generation
  - Create utility function `generatePreviewToken(companyId, userId, updates)`
  - Hash updates with SHA256
  - Sign JWT with hash, companyId, userId, expiry (10 min)
  - **Files:** `utils/previewToken.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 3.2:** Build preview endpoint
  - Create `POST /api/company/:id/configuration/variables/preview`
  - Load company + template
  - Find all scenarios using changed variables
  - Generate before/after examples (max 10)
  - Create preview token
  - Return preview data
  - **Files:** `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 2 hours

- [ ] **Task 3.3:** Create IdempotencyLog schema
  - Create `models/IdempotencyLog.js`
  - Fields: key (unique), companyId, userId, action, response, createdAt
  - TTL index: expire after 24 hours
  - **Files:** `models/IdempotencyLog.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 3.4:** Create AuditLog schema
  - Create `models/AuditLog.js`
  - Fields: auditId, companyId, userId, action, changes (before/after/diff), impact, metadata (previewToken, idempotencyKey, IP, UA), timestamp
  - **Files:** `models/AuditLog.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 3.5:** Build apply endpoint
  - Create `POST /api/company/:id/configuration/variables/apply`
  - Verify preview token (check hash matches)
  - Check idempotency key (prevent double-apply)
  - Validate all variables
  - Wrap in transaction: update company + create audit log
  - Invalidate readiness cache
  - Return success with auditId
  - **Files:** `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 2 hours

#### ✅ Frontend UI

- [ ] **Task 3.6:** Build preview modal
  - Create modal HTML structure
  - Summary cards: variables changing, scenarios affected
  - Changes list: show old → new for each variable
  - Examples section: show 5 before/after comparisons
  - "View All" link for full list
  - Add countdown timer: "Token expires in 09:59"
  - **Files:** `public/company-profile.html`
  - **Estimated Time:** 2 hours

- [ ] **Task 3.7:** Wire Preview button
  - Modify `VariablesManager.js`
  - Collect changed variables
  - Call preview endpoint
  - Display preview modal
  - Store preview token
  - **Files:** `public/js/ai-agent-settings/VariablesManager.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 3.8:** Wire Apply button
  - Generate UUID for Idempotency-Key
  - Call apply endpoint with preview token + idempotency key
  - Handle success: show notification, refresh configuration
  - Handle errors: show error message
  - Close modal on success
  - **Files:** `public/js/ai-agent-settings/VariablesManager.js`
  - **Estimated Time:** 1 hour

---

### **PHASE 4: VARIABLE VALIDATION** (Day 4 - 4 hours)

#### ✅ Backend Logic

- [ ] **Task 4.1:** Add variableDefinitions to schema
  - Update `models/GlobalInstantResponseTemplate.js`
  - Create VariableDefinitionSchema
  - Fields: key, label, description, type, required, enumValues, validation (regex), example, category, usageCount, placeholder
  - Replace simple `availableVariables` array with structured definitions
  - **Files:** `models/GlobalInstantResponseTemplate.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 4.2:** Install libphonenumber-js
  - Run `npm install libphonenumber-js`
  - Create phone normalization utility
  - Function: `normalizePhone(value)` returns `{ e164, display }`
  - **Files:** `utils/phoneNormalization.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 4.3:** Build all validators
  - Create `utils/variableValidators.js`
  - Implement 7 validators:
    - text: non-empty string
    - email: regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
    - phone: use libphonenumber-js
    - url: regex `/^https?:\/\/[^\s]+\.[^\s]+$/`
    - currency: regex `/^\$?\d{1,6}(\.\d{2})?$/`
    - enum: value in allowed list
    - multiline: non-empty string
  - Each validator returns `{ isValid, errorMessage, formatted? }`
  - **Files:** `utils/variableValidators.js`
  - **Estimated Time:** 1.5 hours

- [ ] **Task 4.4:** Add validation to PATCH endpoint
  - In `PATCH /configuration/variables`
  - Load variable definitions from template
  - Validate each variable against its type
  - Return 400 with validation errors if any fail
  - Only proceed if all valid
  - **Files:** `routes/company/v2companyConfiguration.js`
  - **Estimated Time:** 1 hour

#### ✅ Frontend Validation

- [ ] **Task 4.5:** Add inline validation to VariablesManager
  - Modify `VariablesManager.js`
  - Load variable definitions
  - On input blur: call `validateInput(input)`
  - If invalid: add `.error` class, show error message below input
  - If valid: add `.valid` class, show green checkmark
  - Disable save button until all required fields valid
  - **Files:** `public/js/ai-agent-settings/VariablesManager.js`
  - **Estimated Time:** 2 hours

- [ ] **Task 4.6:** Add error message UI
  - Create `.validation-error` CSS class
  - Show icon + message + example
  - Position below input field
  - Auto-hide when user fixes error
  - **Files:** `public/css/ai-agent-settings.css`, `VariablesManager.js`
  - **Estimated Time:** 1 hour

---

### **PHASE 5: URGENCY KEYWORDS (ADMIN EDITABLE)** (Day 5 - 4 hours)

#### ✅ Backend Schema & API

- [ ] **Task 5.1:** Add urgencyKeywords to schema
  - Update `models/GlobalInstantResponseTemplate.js`
  - Create UrgencyKeywordSchema
  - Fields: word, weight, category, examples (array)
  - Add `urgencyKeywords` array to main schema
  - **Files:** `models/GlobalInstantResponseTemplate.js`
  - **Estimated Time:** 30 minutes

- [ ] **Task 5.2:** Build urgency keywords CRUD endpoints
  - Create in `routes/admin/globalInstantResponses.js`:
    - `POST /:id/urgency-keywords` (add)
    - `GET /:id/urgency-keywords` (list)
    - `PATCH /:id/urgency-keywords/:keywordId` (update)
    - `DELETE /:id/urgency-keywords/:keywordId` (delete)
  - Validation: weight between 0.1-0.5
  - **Files:** `routes/admin/globalInstantResponses.js`
  - **Estimated Time:** 2 hours

#### ✅ Frontend Admin UI

- [ ] **Task 5.3:** Build urgency keywords UI in Global AI Brain
  - Add "Urgency Keywords" section to Settings tab
  - Search bar + "Add Keyword" button
  - Table showing: keyword, weight, category, examples, actions
  - Edit and delete buttons per row
  - Stats bar: total keywords, categories
  - **Files:** `public/admin-global-instant-responses.html`
  - **Estimated Time:** 2 hours

- [ ] **Task 5.4:** Build add/edit modal
  - Modal form with fields: word, weight (dropdown), category, examples (textarea)
  - Validation: word required, weight required
  - Save button calls API
  - **Files:** `public/admin-global-instant-responses.html`
  - **Estimated Time:** 1.5 hours

#### ✅ Integration

- [ ] **Task 5.5:** Update HybridScenarioSelector
  - Modify `services/HybridScenarioSelector.js`
  - Load urgency keywords from template
  - In `calculateEmergencyScore()`:
    - Check for keyword matches with word boundaries (`\bword\b`)
    - Add weight boost for each match
    - Cap total boost at 0.5
    - Log detected keywords
  - **Files:** `services/HybridScenarioSelector.js`
  - **Estimated Time:** 1 hour

- [ ] **Task 5.6:** Add urgency keywords inheritance
  - When company clones template
  - Copy urgency keywords to `company.configuration.urgencyKeywords.inherited`
  - Company can view but not edit inherited
  - Company can add custom keywords
  - **Files:** Clone template logic (to be identified)
  - **Estimated Time:** 1 hour

---

### **PHASE 6: TESTING** (Day 6 - 4 hours)

#### ✅ Unit Tests

- [ ] **Task 6.1:** Test readiness calculation
  - Create `tests/services/ConfigurationReadinessService.test.js`
  - Test cases:
    - All requirements met (score = 100)
    - Missing variables (score reduces)
    - No scenarios active (critical blocker)
    - Edge cases (0 scenarios, 0 variables)
  - **Estimated Time:** 1 hour

- [ ] **Task 6.2:** Test variable validators
  - Create `tests/utils/variableValidators.test.js`
  - Test all 7 validators with valid and invalid inputs
  - Test edge cases (empty, null, malformed)
  - Test phone normalization (various formats)
  - **Estimated Time:** 1.5 hours

#### ✅ Integration Tests

- [ ] **Task 6.3:** Test preview → apply flow
  - Create `tests/integration/previewApply.test.js`
  - Test preview generates correct token
  - Test apply with valid token succeeds
  - Test apply with expired token fails
  - Test apply with wrong updates (hash mismatch) fails
  - **Estimated Time:** 1.5 hours

- [ ] **Task 6.4:** Test idempotency
  - Create `tests/integration/idempotency.test.js`
  - Apply same changes with same idempotency key twice
  - Expect: 1st call succeeds, 2nd returns same result
  - Verify only 1 audit log created
  - **Estimated Time:** 1 hour

- [ ] **Task 6.5:** Test security
  - Create `tests/integration/security.test.js`
  - Test: User A cannot access Company B's config
  - Test: Rate limiting blocks excessive requests
  - Test: RBAC prevents unauthorized mutations
  - **Estimated Time:** 1.5 hours

---

### **PHASE 7: DOCUMENTATION & DEPLOYMENT** (Day 7 - 3 hours)

#### ✅ Documentation

- [ ] **Task 7.1:** Update architecture document
  - Expand `AI-AGENT-SETTINGS-ARCHITECTURE.md`
  - Document all Phase 2 features
  - Add API endpoint reference
  - Add security considerations
  - **Estimated Time:** 1 hour

- [ ] **Task 7.2:** Write user guide
  - Create "How to Use Readiness Gate" section
  - Create "How to Preview Variable Changes" section
  - Create "How to Add Urgency Keywords" section
  - Add screenshots/diagrams
  - **Files:** Create user-facing docs
  - **Estimated Time:** 1 hour

#### ✅ Deployment

- [ ] **Task 7.3:** Deploy to staging
  - Deploy code to Render staging environment
  - Test with real company data
  - Verify readiness calculation
  - Test preview/apply flow end-to-end
  - Fix any bugs found
  - **Estimated Time:** 2 hours

- [ ] **Task 7.4:** Monitor and fix issues
  - Check logs for errors
  - Monitor Redis cache performance
  - Check audit logs are being created
  - Verify rate limiting works
  - **Estimated Time:** 1 hour

- [ ] **Task 7.5:** Deploy to production
  - Deploy to production Render environment
  - Enable for 5 test companies first
  - Monitor for 24 hours
  - Gradually roll out to all companies
  - **Estimated Time:** 2 hours (spread over days)

---

## 📂 **FILES TO CREATE**

### New Files (12)
1. ✅ `middleware/configSecurity.js` - Security middleware
2. ✅ `utils/logRedaction.js` - Log redaction utility
3. ✅ `services/ConfigurationReadinessService.js` - Readiness calculation
4. ✅ `utils/previewToken.js` - Preview token generation
5. ✅ `models/IdempotencyLog.js` - Idempotency tracking
6. ✅ `models/AuditLog.js` - Audit log tracking
7. ✅ `utils/phoneNormalization.js` - Phone number normalization
8. ✅ `utils/variableValidators.js` - Variable type validators
9. ✅ `tests/services/ConfigurationReadinessService.test.js`
10. ✅ `tests/utils/variableValidators.test.js`
11. ✅ `tests/integration/previewApply.test.js`
12. ✅ `tests/integration/idempotency.test.js`
13. ✅ `tests/integration/security.test.js`
14. ✅ `AI-AGENT-SETTINGS-PHASE-2-TODOS.md` (this file)

### Modified Files (8)
1. ✅ `routes/company/v2companyConfiguration.js` - Add new endpoints
2. ✅ `models/v2Company.js` - Add readiness tracking
3. ✅ `models/GlobalInstantResponseTemplate.js` - Add variable defs + urgency keywords
4. ✅ `public/js/ai-agent-settings/AIAgentSettingsManager.js` - Readiness UI
5. ✅ `public/js/ai-agent-settings/VariablesManager.js` - Preview/validation
6. ✅ `public/company-profile.html` - Go Live button + preview modal
7. ✅ `public/admin-global-instant-responses.html` - Urgency keywords UI
8. ✅ `services/HybridScenarioSelector.js` - Urgency keyword matching
9. ✅ `routes/admin/globalInstantResponses.js` - Urgency keywords CRUD

---

## 🎯 **SUCCESS CRITERIA**

### Must Pass Before Deploying
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Security tests passing (RBAC, rate limiting, cross-company protection)
- [ ] Readiness score accurate (tested with 3 different companies)
- [ ] Preview → Apply flow works end-to-end
- [ ] Idempotency prevents double-apply
- [ ] Variable validation rejects invalid data
- [ ] Urgency keywords boost emergency scoring
- [ ] No console errors in browser
- [ ] No errors in Render logs
- [ ] Documentation complete

---

## 📊 **ESTIMATED TIME BREAKDOWN**

| Phase | Tasks | Hours |
|-------|-------|-------|
| 1. Security Foundations | 5 | 4h |
| 2. Readiness Gate | 7 | 8h |
| 3. Preview Before Apply | 8 | 12h |
| 4. Variable Validation | 6 | 7h |
| 5. Urgency Keywords | 6 | 8h |
| 6. Testing | 5 | 7h |
| 7. Documentation & Deployment | 5 | 6h |
| **TOTAL** | **42 tasks** | **52 hours** |

---

## 🚨 **CRITICAL CHECKPOINTS**

### After Day 1 (Security)
- ✅ Can only access own company's config
- ✅ Rate limiting blocks excessive requests
- ✅ Logs don't contain sensitive data

### After Day 2 (Readiness)
- ✅ Readiness score displays correctly
- ✅ Go Live button disables when not ready
- ✅ Blockers show with fix buttons

### After Day 3 (Preview/Apply)
- ✅ Preview shows accurate before/after
- ✅ Apply requires preview first
- ✅ Idempotency prevents double-apply
- ✅ Audit logs created

### After Day 4 (Validation)
- ✅ Invalid email rejected
- ✅ Invalid phone rejected
- ✅ Invalid currency rejected
- ✅ Cannot save until all valid

### After Day 5 (Urgency Keywords)
- ✅ Admin can add/edit/delete keywords
- ✅ Keywords boost emergency scoring
- ✅ Test log shows detected keywords

### After Day 6 (Testing)
- ✅ All tests passing
- ✅ No regressions found

### After Day 7 (Deployment)
- ✅ Deployed to production
- ✅ Working for test companies
- ✅ No errors in production logs

---

## 📝 **NOTES FOR LONG BUILD SESSION**

### When You Need a Break
1. Commit your current progress
2. Update this TODO with completed items
3. Note where you left off
4. Push to git

### Before Starting Each Day
1. Review this TODO list
2. Identify today's phase
3. Set up any required tools/libraries
4. Run `git status` to ensure clean state

### After Completing Each Task
1. Test the feature
2. Check for console errors
3. Update TODO status
4. Commit with descriptive message

### If You Get Stuck
1. Check related files for patterns
2. Review architecture document
3. Test in isolation
4. Ask for clarification

### Quality Checklist (Every Task)
- [ ] Code follows existing patterns
- [ ] No console errors
- [ ] No linter errors
- [ ] Comments explain WHY, not WHAT
- [ ] Error handling present
- [ ] User-friendly error messages

---

## 🎉 **COMPLETION CELEBRATION**

When all 42 tasks are complete:
1. ✅ Run full test suite
2. ✅ Deploy to production
3. ✅ Monitor for 24 hours
4. ✅ Document lessons learned
5. ✅ Plan Phase 3 (Memory System)

---

**Last Updated:** October 13, 2025  
**Version:** 1.0  
**Owner:** Marc + AI Coding Assistant  
**Status:** Ready to Begin 🚀

