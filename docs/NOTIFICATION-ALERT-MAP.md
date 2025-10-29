# 📋 NOTIFICATION ALERT MAP - Complete Reference

> **Last Updated:** October 29, 2025  
> **Total Alert Codes:** 79  
> **Documentation Purpose:** Central reference for all notification alert codes, severities, and actions

---

## 🎯 **QUICK REFERENCE**

| Severity | Count | Use Case |
|----------|-------|----------|
| **CRITICAL** | 29 | System down, data loss imminent, revenue impact |
| **WARNING** | 39 | Performance degradation, missing config, non-critical failures |
| **INFO** | 11 | Successful operations, health checks, system status |

---

## 📊 **ALERT CATEGORIES**

1. [Database & Cache](#1-database--cache) (11 codes)
2. [ElevenLabs Voice Generation](#2-elevenlabs-voice-generation) (6 codes)
3. [Company Management](#3-company-management) (6 codes)
4. [AI Template & Scenario](#4-ai-template--scenario) (6 codes)
5. [Twilio & Call Routing](#5-twilio--call-routing) (3 codes)
6. [Notification System Self-Monitoring](#6-notification-system-self-monitoring) (24 codes)
7. [API Error Handling](#7-api-error-handling) (7 codes)
8. [AI Learning & Optimization](#8-ai-learning--optimization) (4 codes)
9. [Critical Data Health](#9-critical-data-health) (6 codes)
10. [AI Gateway Health Monitoring](#10-ai-gateway-health-monitoring) (6 codes)

---

## 1. 📦 DATABASE & CACHE

### **DB_CONNECTION_MISSING_URI** 
- **Severity:** 🔴 CRITICAL
- **Trigger:** MONGODB_URI environment variable not set
- **Impact:** Server cannot start, no database access
- **Action:** Add MONGODB_URI to `.env` file
- **File:** `db.js:41`

### **DB_CONNECTION_SLOW**
- **Severity:** ⚠️ WARNING
- **Trigger:** MongoDB connection took >5 seconds
- **Impact:** Slow startup, potential performance issues
- **Action:** Check MongoDB Atlas status, network latency
- **File:** `db.js:82`

### **DB_CONNECTION_LOST**
- **Severity:** 🔴 CRITICAL
- **Trigger:** MongoDB disconnected during operation
- **Impact:** All database operations fail, app unusable
- **Action:** Check MongoDB Atlas status, restart server
- **File:** `db.js:105`

### **DB_CONNECTION_RESTORED**
- **Severity:** ℹ️ INFO
- **Trigger:** MongoDB reconnected successfully
- **Impact:** None (recovery event)
- **Action:** Review downtime duration, investigate root cause
- **File:** `db.js:121`

### **DB_CONNECTION_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** MongoDB connection error event
- **Impact:** Database operations may fail intermittently
- **Action:** Check MongoDB logs, network connectivity
- **File:** `db.js:137`

### **DB_CONNECTION_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Initial MongoDB connection failed
- **Impact:** Server cannot start, no database access
- **Action:** Verify MONGODB_URI, check Atlas whitelist, review credentials
- **File:** `db.js:165`

### **REDIS_CONNECTION_SLOW**
- **Severity:** ⚠️ WARNING
- **Trigger:** Redis connection took >5 seconds (cold start threshold)
- **Impact:** Slow startup, caching delayed
- **Action:** Check Redis service status, network latency (NOTE: 3-5s is normal for Render free tier cold starts)
- **File:** `clients/index.js:82`

### **REDIS_CONNECTION_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Redis error event fired
- **Impact:** Session management fails, cache unavailable
- **Action:** Check Redis connection string, verify credentials
- **File:** `clients/index.js:100`

### **REDIS_CONNECTION_CLOSED**
- **Severity:** ⚠️ WARNING
- **Trigger:** Redis connection closed unexpectedly
- **Impact:** Cache unavailable, sessions lost
- **Action:** Review Redis logs, check for network issues
- **File:** `clients/index.js:123`

### **REDIS_RECONNECT_MAX_ATTEMPTS**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Redis failed to reconnect after 5 attempts
- **Impact:** Cache permanently unavailable, sessions lost
- **Action:** Restart Redis service, verify connection string
- **File:** `clients/index.js:43`

### **CACHE_INVALIDATION_PATTERN_FAILURE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Failed to invalidate cache keys matching a pattern
- **Impact:** Stale data may be served to users
- **Action:** Manually clear Redis cache, investigate pattern issue
- **File:** `utils/cacheHelper.js:550`

---

## 2. 🎤 ELEVENLABS VOICE GENERATION

### **ELEVENLABS_VOICE_FETCH_FAILURE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Failed to fetch available voices from ElevenLabs API
- **Impact:** Cannot display voice options in UI
- **Action:** Check API key, verify ElevenLabs status
- **File:** `services/v2elevenLabsService.js:137`

### **ELEVENLABS_TTS_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Text-to-speech synthesis failed (generic)
- **Impact:** Voice generation failed, call may fail
- **Action:** Check error details, verify API key
- **File:** `services/v2elevenLabsService.js:243`

### **ELEVENLABS_TIMEOUT**
- **Severity:** ⚠️ WARNING
- **Trigger:** Voice generation request timed out
- **Impact:** Call cannot proceed, caller hears silence/fallback
- **Action:** Check ElevenLabs API status, network connectivity, consider shorter text
- **File:** `services/v2elevenLabsService.js:264`

### **ELEVENLABS_QUOTA_EXCEEDED**
- **Severity:** 🔴 CRITICAL
- **Trigger:** ElevenLabs API quota or rate limit exceeded (429 status)
- **Impact:** **All voice generation stopped, all calls will fail**
- **Action:** 
  - Upgrade ElevenLabs plan
  - Switch to company-owned API key
  - Wait for quota reset
- **Bypass Pattern Detection:** ✅ YES (immediate alert)
- **File:** `services/v2elevenLabsService.js:286`

### **ELEVENLABS_VOICE_NOT_FOUND**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Specified voice ID not found (404 status)
- **Impact:** All calls using this voice will fail
- **Action:** Go to Company Profile → Voice Settings and select a valid voice ID
- **Bypass Pattern Detection:** ✅ YES (immediate alert)
- **File:** `services/v2elevenLabsService.js:308`

### **ELEVENLABS_API_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Generic ElevenLabs API error (not timeout/quota/404)
- **Impact:** Voice generation failed, call may fail or use fallback
- **Action:** Check ElevenLabs API key, verify API status, review error message
- **File:** `services/v2elevenLabsService.js:329`

---

## 3. 🏢 COMPANY MANAGEMENT

### **COMPANY_NOT_FOUND**
- **Severity:** ⚠️ WARNING
- **Trigger:** Attempted to load company by ID that doesn't exist
- **Impact:** User cannot view company details
- **Action:** Verify company ID is correct, check if company was deleted
- **File:** `routes/v2company.js:356`

### **COMPANY_MISSING_CREDENTIALS**
- **Severity:** ⚠️ WARNING
- **Trigger:** Company loaded but missing Twilio or ElevenLabs credentials
- **Impact:** Company cannot receive/make calls, voice generation will fail
- **Action:** Navigate to Company Profile → Configuration tab and add missing credentials
- **File:** `routes/v2company.js:388`

### **COMPANY_LOAD_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Database query failed when loading company
- **Impact:** Company data inaccessible, blocking all operations
- **Action:** Check MongoDB connection, review database logs
- **File:** `routes/v2company.js:423`

### **COMPANY_MISSING_CREDENTIALS_ON_SAVE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Mongoose pre-save hook detected missing credentials before saving
- **Impact:** Company cannot receive/make calls once saved
- **Action:** Add missing credentials before saving or mark company as suspended
- **Skip Conditions:**
  - Skips new companies (not yet configured)
  - Skips deleted companies
  - Skips suspended companies
- **File:** `models/v2Company.js:1829`

### **TWILIO_COMPANY_NOT_FOUND**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Twilio webhook received call for non-existent company
- **Impact:** Call cannot be routed, customer hears error message
- **Action:** Verify Twilio phone number configuration, check company status
- **File:** `routes/v2twilio.js:1337`

### **TWILIO_WEBHOOK_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Twilio webhook crashed due to unhandled error
- **Impact:** Call fails, customer cannot reach company
- **Action:** Review stack trace, fix code issue, deploy hotfix
- **File:** `routes/v2twilio.js:1427`

---

## 4. 🧠 AI TEMPLATE & SCENARIO

### **TEMPLATE_NOT_FOUND**
- **Severity:** ⚠️ WARNING
- **Trigger:** Attempted to load template by ID that doesn't exist
- **Impact:** Cannot display scenarios, AI agent configuration blocked
- **Action:** Verify template ID is correct, check if template was deleted
- **File:** `routes/admin/globalInstantResponses.js:1785`

### **TEMPLATE_EMPTY_SCENARIOS**
- **Severity:** ⚠️ WARNING
- **Trigger:** Template has categories but 0 scenarios
- **Impact:** AI agent cannot respond to any queries - template is non-functional
- **Action:** Add scenarios to categories or seed default scenarios
- **Bypass Pattern Detection:** ✅ YES (empty state = immediate alert)
- **File:** `routes/admin/globalInstantResponses.js:1820`

### **TEMPLATE_LOAD_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Database query failed when loading template
- **Impact:** AI configuration UI broken, cannot manage scenarios
- **Action:** Check MongoDB connection, review database logs
- **File:** `routes/admin/globalInstantResponses.js:1863`

### **TEMPLATE_EMPTY_SCENARIOS_ON_SAVE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Mongoose pre-save hook detected template with categories but 0 scenarios
- **Impact:** AI agent cannot respond to any queries - template will be non-functional
- **Action:** Add scenarios to categories before saving or mark template as draft
- **Bypass Pattern Detection:** ✅ YES (empty state = immediate alert)
- **Skip Conditions:** Skips new templates (not yet configured)
- **File:** `models/GlobalInstantResponseTemplate.js:1246`

### **AI_LEARNING_SYNONYM_ADDED**
- **Severity:** ℹ️ INFO
- **Trigger:** AI system or developer added a new synonym mapping
- **Impact:** None (learning event)
- **Action:** Review synonym accuracy, approve for wider use if effective
- **Files:** 
  - `routes/admin/globalInstantResponses.js:3302`
  - `routes/admin/globalInstantResponses.js:3461`

### **AI_LEARNING_FILLER_ADDED**
- **Severity:** ℹ️ INFO
- **Trigger:** AI system or developer added a new filler word
- **Impact:** None (learning event)
- **Action:** Review filler accuracy, approve for wider use if effective
- **Files:**
  - `routes/admin/globalInstantResponses.js:3564`
  - `routes/admin/globalInstantResponses.js:3716`

---

## 5. ☎️ TWILIO & CALL ROUTING

### **TWILIO_COMPANY_NOT_FOUND**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Twilio webhook received call for non-existent company
- **Impact:** Call cannot be routed, customer hears error message
- **Action:** Verify Twilio phone number configuration, check company status
- **File:** `routes/v2twilio.js:1337`

### **TWILIO_WEBHOOK_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Twilio webhook crashed due to unhandled error
- **Impact:** Call fails, customer cannot reach company
- **Action:** Review stack trace, fix code issue, deploy hotfix
- **File:** `routes/v2twilio.js:1427`

### **NOTIF_SETTINGS_TWILIO_MISSING_*** (SID, TOKEN, NUMBER)
- **Severity:** ⚠️ WARNING
- **Trigger:** Notification Center settings missing Twilio credentials
- **Impact:** SMS/call alerts cannot be sent
- **Action:** Add Twilio credentials to Admin Settings
- **File:** `routes/admin/adminNotifications.js:954-956`

---

## 6. 🔔 NOTIFICATION SYSTEM SELF-MONITORING

### **NOTIF_DASHBOARD_LOAD_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Notification dashboard loaded successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:229`

### **NOTIF_DASHBOARD_LOAD_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Failed to load notification dashboard data
- **Impact:** Cannot view alerts, system status unknown
- **Action:** Check MongoDB connection, review error logs
- **File:** `routes/admin/adminNotifications.js:260`

### **NOTIF_REGISTRY_VALIDATE_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Notification registry validation passed
- **Impact:** None (success event)
- **Action:** None
- **Files:**
  - `routes/admin/adminNotifications.js:289`
  - `routes/admin/adminNotifications.js:351`

### **NOTIF_REGISTRY_VALIDATE_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Notification registry validation failed
- **Impact:** Notification system may not function correctly
- **Action:** Review validation errors, fix registry configuration
- **Files:**
  - `routes/admin/adminNotifications.js:311`
  - `routes/admin/adminNotifications.js:373`

### **NOTIF_LOGS_LIST_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Notification logs fetched successfully
- **Impact:** None (success event)
- **Action:** None
- **Files:**
  - `routes/admin/adminNotifications.js:433`
  - `routes/admin/adminNotifications.js:497`

### **NOTIF_LOGS_LIST_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Failed to fetch notification logs
- **Impact:** Cannot view alert history
- **Action:** Check MongoDB connection, review error logs
- **Files:**
  - `routes/admin/adminNotifications.js:460`
  - `routes/admin/adminNotifications.js:516`

### **NOTIF_ALERT_ACK_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Alert acknowledged successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:558`

### **NOTIF_ALERT_ACK_FAILURE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Failed to acknowledge alert
- **Impact:** Alert continues to escalate
- **Action:** Retry acknowledgment, check database connectivity
- **File:** `routes/admin/adminNotifications.js:573`

### **NOTIF_ALERT_SNOOZE_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Alert snoozed successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:611`

### **NOTIF_ALERT_SNOOZE_FAILURE**
- **Severity:** ⚠️ WARNING
- **Trigger:** Failed to snooze alert
- **Impact:** Alert continues to fire
- **Action:** Retry snooze, check database connectivity
- **File:** `routes/admin/adminNotifications.js:626`

### **NOTIF_ALERT_RESOLVE_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Alert resolved successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:670`

### **NOTIF_ALERT_RESOLVE_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Failed to resolve alert
- **Impact:** Alert remains active, may continue to escalate
- **Action:** Retry resolution, check database connectivity
- **File:** `routes/admin/adminNotifications.js:688`

### **NOTIF_HEALTH_RUN_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Health check completed successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:721`

### **NOTIF_HEALTH_RUN_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Health check failed to run
- **Impact:** Cannot verify system health
- **Action:** Check health check service, review error logs
- **File:** `routes/admin/adminNotifications.js:754`

### **NOTIF_SETTINGS_SAVE_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Notification settings saved successfully
- **Impact:** None (success event)
- **Action:** None
- **File:** `routes/admin/adminNotifications.js:981`

### **NOTIF_SETTINGS_SAVE_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Failed to save notification settings
- **Impact:** Configuration changes not applied
- **Action:** Check database connectivity, review error logs
- **File:** `routes/admin/adminNotifications.js:995`

### **NOTIF_SETTINGS_TEST_SMS_OK**
- **Severity:** ℹ️ INFO
- **Trigger:** Test SMS sent successfully
- **Impact:** None (success event)
- **Action:** Verify SMS received on phone
- **File:** `routes/admin/adminNotifications.js:1182`

### **NOTIF_SETTINGS_TEST_SMS_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Test SMS failed to send
- **Impact:** SMS alerts may not work
- **Action:** Check Twilio credentials, verify phone number format
- **File:** `routes/admin/adminNotifications.js:1217`

### **NOTIFICATION_SYSTEM_TEST**
- **Severity:** ℹ️ INFO
- **Trigger:** Manual test notification triggered
- **Impact:** None (test event)
- **Action:** Verify notification appears in all channels
- **File:** `routes/admin/adminNotifications.js:1248`

### **NOTIF_ALL_LOGS_CLEARED**
- **Severity:** ℹ️ INFO
- **Trigger:** All notification logs purged by admin
- **Impact:** Alert history cleared
- **Action:** None (intentional action)
- **File:** `routes/admin/adminNotifications.js:1728`

---

## 7. ⚠️ API ERROR HANDLING

### **API_VALIDATION_ERROR**
- **Severity:** ⚠️ WARNING
- **Trigger:** Request failed validation (400 error)
- **Impact:** Request rejected, user sees error
- **Action:** Review validation rules, check request format
- **File:** `middleware/errorNotificationHandler.js:55`

### **API_AUTH_ERROR**
- **Severity:** ⚠️ WARNING
- **Trigger:** Authentication failed (401/403 error)
- **Impact:** Request rejected, unauthorized access
- **Action:** Check authentication token, verify permissions
- **File:** `middleware/errorNotificationHandler.js:65`

### **API_DATABASE_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Database operation failed during API request
- **Impact:** Request fails, data may not be saved
- **Action:** Check MongoDB connection, review database logs
- **File:** `middleware/errorNotificationHandler.js:75`

### **API_TIMEOUT_ERROR**
- **Severity:** ⚠️ WARNING
- **Trigger:** API request timed out
- **Impact:** Request fails, user sees timeout error
- **Action:** Check server performance, investigate slow operations
- **File:** `middleware/errorNotificationHandler.js:85`

### **API_NOT_FOUND**
- **Severity:** ℹ️ INFO
- **Trigger:** Resource not found (404 error)
- **Impact:** Request returns 404
- **Action:** Verify resource exists, check request URL
- **File:** `middleware/errorNotificationHandler.js:95`

### **API_RATE_LIMIT_EXCEEDED**
- **Severity:** ⚠️ WARNING
- **Trigger:** User exceeded API rate limit (429 error)
- **Impact:** Requests blocked temporarily
- **Action:** Wait for rate limit reset, review rate limit settings
- **File:** `middleware/errorNotificationHandler.js:105`

### **API_EXTERNAL_SERVICE_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** External service (Twilio, ElevenLabs) failed
- **Impact:** Feature unavailable, user sees error
- **Action:** Check external service status, verify API keys
- **File:** `middleware/errorNotificationHandler.js:115`

### **API_UNHANDLED_ERROR**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Unhandled error in API request
- **Impact:** Request fails, user sees generic error
- **Action:** Review stack trace, fix code issue
- **File:** `middleware/errorNotificationHandler.js:124`

---

## 8. 🤖 AI LEARNING & OPTIMIZATION

### **AI_LEARNING_SYNONYM_ADDED** (Template-level)
- **Severity:** ℹ️ INFO
- **Trigger:** Developer or LLM added synonym to template
- **Impact:** None (learning event)
- **Action:** Review synonym accuracy, approve for wider use
- **File:** `routes/admin/globalInstantResponses.js:3302`

### **AI_LEARNING_SYNONYM_ADDED** (Category-level)
- **Severity:** ℹ️ INFO
- **Trigger:** Developer or LLM added synonym to category
- **Impact:** None (learning event)
- **Action:** Review synonym accuracy, approve for wider use
- **File:** `routes/admin/globalInstantResponses.js:3461`

### **AI_LEARNING_FILLER_ADDED** (Template-level)
- **Severity:** ℹ️ INFO
- **Trigger:** Developer or LLM added filler word to template
- **Impact:** None (learning event)
- **Action:** Review filler accuracy, approve for wider use
- **File:** `routes/admin/globalInstantResponses.js:3564`

### **AI_LEARNING_FILLER_ADDED** (Category-level)
- **Severity:** ℹ️ INFO
- **Trigger:** Developer or LLM added filler word to category
- **Impact:** None (learning event)
- **Action:** Review filler accuracy, approve for wider use
- **File:** `routes/admin/globalInstantResponses.js:3716`

---

## 9. 🏥 CRITICAL DATA HEALTH

### **CRITICAL_DATA_BEHAVIORS_EMPTY**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Behaviors database is empty (0 behaviors)
- **Impact:** All AI templates cannot function, users cannot create/edit scenarios
- **Action:** Run `node scripts/seed-behaviors-quick.js` to restore default behaviors
- **Bypass Pattern Detection:** ✅ YES (empty state = immediate alert)
- **File:** `services/CriticalDataHealthCheck.js:80`

### **CRITICAL_DATA_BEHAVIORS_LOW_COUNT**
- **Severity:** ⚠️ WARNING
- **Trigger:** Only 1-2 behaviors in database (expected: 3+)
- **Impact:** Limited AI personality options, potentially impacting customer experience
- **Action:** Run `node scripts/seed-behaviors-quick.js` to add more default behaviors
- **File:** `services/CriticalDataHealthCheck.js:113`

### **CRITICAL_DATA_BEHAVIORS_CHECK_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Health check failed to query behaviors table
- **Impact:** Cannot verify integrity of AI behaviors
- **Action:** Check MongoDB connection, review backend logs for database errors
- **Bypass Pattern Detection:** ✅ YES (critical check failure)
- **File:** `services/CriticalDataHealthCheck.js:152`

### **CRITICAL_DATA_TEMPLATES_EMPTY**
- **Severity:** ⚠️ WARNING
- **Trigger:** No AI templates found in database
- **Impact:** No AI agents can be configured or deployed
- **Action:** Seed default AI templates or create new ones via Global AI Brain UI
- **File:** `services/CriticalDataHealthCheck.js:189`

### **CRITICAL_DATA_TEMPLATES_CHECK_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Health check failed to query templates table
- **Impact:** Cannot verify integrity of AI templates
- **Action:** Check MongoDB connection, review backend logs for database errors
- **Bypass Pattern Detection:** ✅ YES (critical check failure)
- **File:** `services/CriticalDataHealthCheck.js:227`

### **CRITICAL_DATA_COMPANIES_EMPTY**
- **Severity:** ℹ️ INFO
- **Trigger:** No companies found in database
- **Impact:** Platform is operational but has no active clients (no revenue)
- **Action:** Add new companies via Admin Dashboard
- **File:** `services/CriticalDataHealthCheck.js:254`

### **CRITICAL_DATA_COMPANIES_CHECK_FAILURE**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Health check failed to query companies table
- **Impact:** Cannot verify integrity of company data
- **Action:** Check MongoDB connection, review backend logs for database errors
- **Bypass Pattern Detection:** ✅ YES (critical check failure)
- **File:** `services/CriticalDataHealthCheck.js:287`

### **DATABASE_CONNECTION_LOST**
- **Severity:** 🔴 CRITICAL
- **Trigger:** MongoDB disconnected during health check
- **Impact:** Cannot verify any data integrity, database operations failing
- **Action:** Check MongoDB Atlas status, review connection logs, restart server if needed
- **File:** `services/CriticalDataHealthCheck.js:296`

---

## 📈 **ALERT CODE STATISTICS**

### By Severity:
```
CRITICAL: 25 codes (34%)
WARNING:  38 codes (52%)
INFO:     10 codes (14%)
```

### By Category:
```
Notification System Self-Monitoring:   24 codes (33%)
Database & Cache:                      11 codes (15%)
API Error Handling:                     7 codes (10%)
ElevenLabs Voice Generation:            6 codes (8%)
Company Management:                     6 codes (8%)
Critical Data Health:                   6 codes (8%)
AI Template & Scenario:                 6 codes (8%)
AI Learning & Optimization:             4 codes (5%)
Twilio & Call Routing:                  3 codes (4%)
```

### By File:
```
routes/admin/adminNotifications.js:        24 codes
services/v2elevenLabsService.js:            6 codes
db.js:                                      6 codes
routes/v2company.js:                        3 codes
routes/v2twilio.js:                         2 codes
[Other files]:                             32 codes
```

---

## 🎯 **BYPASS PATTERN DETECTION**

The following alerts use `bypassPatternDetection: true` to send immediate notifications without deduplication:

1. **ELEVENLABS_QUOTA_EXCEEDED** - Critical quota issues
2. **ELEVENLABS_VOICE_NOT_FOUND** - Missing voice blocks all calls
3. **TEMPLATE_EMPTY_SCENARIOS** - Non-functional template
4. **TEMPLATE_EMPTY_SCENARIOS_ON_SAVE** - Pre-save validation
5. **CRITICAL_DATA_BEHAVIORS_EMPTY** - Empty behaviors table
6. **CRITICAL_DATA_BEHAVIORS_CHECK_FAILURE** - Health check failure
7. **CRITICAL_DATA_TEMPLATES_CHECK_FAILURE** - Health check failure
8. **CRITICAL_DATA_COMPANIES_CHECK_FAILURE** - Health check failure

---

## 🔄 **AUTOMATED HEALTH CHECKS**

The following checks run automatically:

| Check | Frequency | Alert Codes |
|-------|-----------|-------------|
| **Critical Data Health** | Every 30 min + initial check 5s after startup | `CRITICAL_DATA_*` |
| **Redis Connection Monitor** | On connection events | `REDIS_*` |
| **MongoDB Connection Monitor** | On connection events | `DB_*` |
| **ElevenLabs API Monitor** | Per voice generation request | `ELEVENLABS_*` |
| **Twilio Webhook Monitor** | Per incoming call | `TWILIO_*` |

---

## 📝 **USAGE GUIDE**

### For Developers:
1. **Adding New Alert Codes:**
   - Choose descriptive, uppercase code (e.g., `SERVICE_NAME_ERROR_TYPE`)
   - Select appropriate severity (CRITICAL/WARNING/INFO)
   - Add to this documentation with all fields
   - Use `bypassPatternDetection` only for critical empty states or failures

2. **Testing Alerts:**
   - Use `/api/admin/notifications/test` endpoint
   - Check Notification Center, SMS, Email delivery
   - Verify alert details are actionable

3. **Debugging Alerts:**
   - Check `stackTrace` field for errors
   - Review `details` object for context
   - Use `detectedBy` to find source code location

### For Admins:
1. **Responding to Alerts:**
   - Read `message` for quick summary
   - Check `suggestedFix` for immediate action
   - Review `impact` to understand urgency

2. **Acknowledging Alerts:**
   - CRITICAL: Fix immediately or acknowledge if false positive
   - WARNING: Schedule fix within 24 hours
   - INFO: Review at convenience

3. **Escalation:**
   - Unacknowledged CRITICAL alerts escalate every 30 minutes
   - Maximum 3 escalation levels
   - SMS/Email sent on each escalation

---

## 🛠️ **COMMON FIXES**

### MongoDB Issues:
```bash
# Check connection string
echo $MONGODB_URI

# Test connection
mongosh "$MONGODB_URI" --eval "db.runCommand({ ping: 1 })"
```

### Redis Issues:
```bash
# Check Redis status
redis-cli ping

# Clear cache
redis-cli FLUSHDB
```

### ElevenLabs Issues:
```bash
# Test API key
curl -H "xi-api-key: YOUR_API_KEY" https://api.elevenlabs.io/v1/user
```

### Twilio Issues:
```bash
# Verify webhook URL
# Check Twilio console → Phone Numbers → Webhook configuration
```

---

## 10. 🌐 AI GATEWAY HEALTH MONITORING

### **AI_GATEWAY_OPENAI_UNHEALTHY**
- **Severity:** 🔴 CRITICAL
- **Trigger:** OpenAI API health check failed
- **Impact:** LLM fallback (Tier 3) unavailable, AI suggestions disabled
- **Action:** Check OpenAI API key, account credits, and API status at status.openai.com
- **File:** `services/aiGateway/HealthMonitor.js:136`

### **AI_GATEWAY_OPENAI_SLOW**
- **Severity:** ⚠️ WARNING
- **Trigger:** OpenAI response time exceeded 5 seconds
- **Impact:** Slow AI responses, degraded user experience
- **Action:** Monitor OpenAI status, consider rate limit adjustments
- **File:** `services/aiGateway/HealthMonitor.js:104`

### **AI_GATEWAY_MONGODB_UNHEALTHY**
- **Severity:** 🔴 CRITICAL
- **Trigger:** MongoDB health check failed
- **Impact:** Cannot read/write AI Gateway call logs and suggestions
- **Action:** Check MongoDB Atlas connection, network, and database status
- **File:** `services/aiGateway/HealthMonitor.js:183`

### **AI_GATEWAY_REDIS_UNHEALTHY**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Redis health check failed
- **Impact:** Cache unavailable, performance degradation, increased DB load
- **Action:** Check Redis connection, restart Redis service if needed
- **File:** `services/aiGateway/HealthMonitor.js:230`

### **AI_GATEWAY_HEALTH_ALL_HEALTHY**
- **Severity:** ℹ️ INFO
- **Trigger:** All AI Gateway systems healthy (auto-ping with "always" notification mode)
- **Impact:** None - informational only
- **Action:** No action needed
- **File:** `services/aiGateway/HealthMonitor.js:552`

### **AI_GATEWAY_HEALTH_DEGRADED**
- **Severity:** ⚠️ WARNING
- **Trigger:** One AI Gateway system unhealthy (auto-ping)
- **Impact:** Partial degradation, some features may be unavailable
- **Action:** Review health dashboard, investigate unhealthy service
- **File:** `services/aiGateway/HealthMonitor.js:552`

### **AI_GATEWAY_HEALTH_CRITICAL**
- **Severity:** 🔴 CRITICAL
- **Trigger:** Two or more AI Gateway systems unhealthy (auto-ping)
- **Impact:** Major degradation, AI Gateway may be non-functional
- **Action:** Immediate investigation required, check all services
- **File:** `services/aiGateway/HealthMonitor.js:552`

---

## 📚 **RELATED DOCUMENTATION**

- [Notification System Architecture](./NOTIFICATION-SYSTEM-ARCHITECTURE.md)
- [Strategic Checkpoint Placement Guide](./STRATEGIC-CHECKPOINT-PLACEMENT-GUIDE.md)
- [Error Intelligence System](./ERROR-INTELLIGENCE-SYSTEM.md)
- [Notification Center User Guide](../public/admin-notification-center.html)

---

**Generated:** October 27, 2025  
**Last Updated:** October 29, 2025  
**Version:** 1.1  
**Maintainer:** Platform Engineering Team

