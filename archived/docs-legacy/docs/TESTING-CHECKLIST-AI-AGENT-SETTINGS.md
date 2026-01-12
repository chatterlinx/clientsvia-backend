# 🧪 AI Agent Settings - Testing Checklist

**Date:** October 17, 2025  
**Status:** Ready for Testing  
**Tester:** ___________

---

## 🎯 Testing Goals

1. ✅ Verify readiness calculation accuracy
2. ✅ Test preview/apply flow with real data
3. ✅ Validate Go Live blocking/unblocking
4. ✅ Verify gatekeeper (account status) functionality
5. ✅ Test urgency keywords in live calls
6. ✅ Validate all integrations work end-to-end

---

## 📋 Pre-Test Setup

### **Environment Check**

```bash
# 1. Verify server is running
curl https://clientsvia-backend.onrender.com/health

# 2. Check Redis connection
# (Should be automatic via Render)

# 3. Get test company ID
# Use: Royal Plumbing (68e3f77a9d623b8058c700c4)
```

### **Required Credentials**

- [x] Admin token: `localStorage.getItem('adminToken')`
- [x] Test company: Royal Plumbing
- [x] Twilio test number: +1-239-561-4603

---

## 🧪 TEST 1: Readiness Calculation

**Goal:** Verify scoring algorithm accuracy

### **Test 1.1: Empty Company (Baseline)**

**Steps:**
1. Create new company OR clear all config from test company
2. Navigate to: `/company/{ID}/ai-agent-settings`
3. Check readiness banner

**Expected Result:**
```
Score: 0/100
Status: ⚠️ Not Ready - 5+ blockers
Blockers:
  - NO_TEMPLATE: No Global AI Brain template cloned
  - MISSING_REQUIRED_VARIABLES: Required variables not configured
  - NO_SCENARIOS: No active scenarios
  - NO_VOICE: No voice selected
  - NO_TEST_CALLS: No test calls made
```

**Actual Result:**
```
Score: _____ / 100
Blockers: _____________________
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 1.2: Account Status Gatekeeper (CRITICAL)**

**Steps:**
1. Use company with full configuration (score should be 80+)
2. Go to Configuration tab
3. Change Account Status to "SUSPENDED"
4. Click "Save Account Status"
5. Go to AI Agent Settings tab
6. Check readiness

**Expected Result:**
```
Blocker Added:
  Code: ACCOUNT_SUSPENDED
  Message: "Account is SUSPENDED - All incoming calls are blocked"
  Severity: critical
  Target: /company/:companyId/config#account-status
  
Can Go Live: false (even if score is 100)
```

**Actual Result:**
```
Can Go Live: _____
Blocker Shown: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 1.3: Call Forward Blocking**

**Steps:**
1. Set Account Status to "CALL FORWARD"
2. Set forward number: +1-555-999-0000
3. Save
4. Check AI Agent Settings

**Expected Result:**
```
Blocker Added:
  Code: ACCOUNT_CALL_FORWARD
  Message: "Account is set to CALL FORWARD - Calls forwarded, not handled by AI"
  Details: "Currently forwarding to: +15559990000"
  
Can Go Live: false
```

**Actual Result:**
```
Can Go Live: _____
Blocker: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 1.4: Active Account (Unblock)**

**Steps:**
1. Set Account Status back to "ACTIVE"
2. Save
3. Check AI Agent Settings

**Expected Result:**
```
Account Status Blocker: REMOVED
Score: Should return to previous value (80+)
Can Go Live: true (if other requirements met)
```

**Actual Result:**
```
Score: _____
Can Go Live: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 1.5: Partial Configuration**

**Steps:**
1. Configure only some requirements:
   - ✅ Template cloned
   - ✅ Voice selected
   - ❌ Variables missing (3 of 8 required)
   - ✅ Scenarios active
   - ❌ No test calls
2. Check score

**Expected Calculation:**
```
Variables:    (5/8 required) = 62.5% × 45% = 28.1%
Scenarios:    100% × 25% = 25%
Voice:        100% × 10% = 10%
Filler Words: 100% × 10% = 10%
Test Calls:   0% × 10% = 0%

Total Score: 28.1 + 25 + 10 + 10 + 0 = 73.1 ≈ 73/100
Can Go Live: false (score < 80)
```

**Actual Result:**
```
Score: _____
Can Go Live: _____
Missing: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 1.6: Full Configuration**

**Steps:**
1. Complete ALL requirements:
   - ✅ Account status: ACTIVE
   - ✅ Template cloned
   - ✅ All required variables filled
   - ✅ Voice selected
   - ✅ Filler words loaded
   - ✅ 3+ test calls made
2. Check score

**Expected Result:**
```
Score: 95-100/100
Can Go Live: true
Blockers: [] (empty)
Go Live Button: 🚀 Go Live Now (enabled)
```

**Actual Result:**
```
Score: _____
Button: _____
```

**Status:** [ ] PASS [ ] FAIL

---

## 🧪 TEST 2: Preview/Apply Flow

**Goal:** Test secure variable changes with preview modal

### **Test 2.1: Preview Generation**

**Steps:**
1. Go to Variables sub-tab
2. Change 3 variables:
   - companyName: "Test HVAC Co"
   - dispatcherPhone: "+1-555-111-2222"
   - emergencyRate: "$199.99"
3. Click "💾 Save Variables"

**Expected Result:**
```
Preview Modal Appears:
  - Summary shows: 3 variables changing
  - Summary shows: X scenarios affected
  - Countdown timer: 10:00
  - Changes list shows before/after for each variable
  - Examples show impact on responses
```

**Actual Result:**
```
Modal appeared: [ ] YES [ ] NO
Countdown working: [ ] YES [ ] NO
Changes shown: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 2.2: Countdown Timer**

**Steps:**
1. Open preview modal
2. Wait 30 seconds
3. Check countdown

**Expected Result:**
```
Timer updates every second
Shows: 9:30, 9:29, 9:28...
Format: MM:SS
```

**Actual Result:**
```
Timer working: [ ] YES [ ] NO
Current time: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 2.3: Apply Changes (Success)**

**Steps:**
1. Generate preview
2. Click "✅ Apply Changes" immediately
3. Wait for response

**Expected Result:**
```
Success Message: "✅ Variables saved successfully!"
Modal closes
Variables updated in UI
Redis cache cleared
Audit log created in database
```

**Check Database:**
```javascript
// Find in MongoDB
db.auditlogs.find({ 
  companyId: ObjectId("..."), 
  action: "update_variables" 
}).sort({ timestamp: -1 }).limit(1)

// Should show:
{
  auditId: "01HXXX...",
  action: "update_variables",
  changes: { 
    diff: { modified: ["companyName", "dispatcherPhone", "emergencyRate"] }
  },
  metadata: { previewToken: "eyJhbGc...", idempotencyKey: "xxxx-..." }
}
```

**Actual Result:**
```
Success: [ ] YES [ ] NO
Audit log created: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 2.4: Token Expiry**

**Steps:**
1. Generate preview
2. Wait 11+ minutes (or modify `expiresAt` in code)
3. Try to apply

**Expected Result:**
```
Error: "Preview expired. Please generate a new preview."
Button disabled
Countdown shows: "Expired" (in red)
```

**Actual Result:**
```
Error shown: [ ] YES [ ] NO
Message: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 2.5: Idempotency (Prevent Double Apply)**

**Steps:**
1. Generate preview
2. Click "Apply Changes" (wait for success)
3. Open browser DevTools → Network tab
4. Click "Apply Changes" again with same token

**Expected Result:**
```
Backend logs:
  [IDEMPOTENCY] ✅ Key already used: xxxx-xxxx...
  
Response: 200 OK (returns cached response)
Database: Only ONE audit log entry (not two)
```

**Actual Result:**
```
Second apply prevented: [ ] YES [ ] NO
Audit logs count: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 2.6: Data Tampering Detection**

**Steps:**
1. Generate preview
2. Open DevTools → Console
3. Modify `variablesManager.variables` data
4. Try to apply

**Expected Result:**
```
Error: "Preview data does not match. Please preview changes again."
Status: 400 Bad Request
Backend logs: [PREVIEW TOKEN] ❌ Hash mismatch!
```

**Actual Result:**
```
Tampering detected: [ ] YES [ ] NO
Error message: _____
```

**Status:** [ ] PASS [ ] FAIL

---

## 🧪 TEST 3: Go Live Flow

**Goal:** Test complete go-live process

### **Test 3.1: Go Live Button Disabled (Not Ready)**

**Steps:**
1. Start with incomplete config (score < 80)
2. Check Go Live button

**Expected Result:**
```
Button text: "🔒 Cannot Go Live"
Button disabled: true
Button class: ai-settings-btn-secondary
Tooltip: "Complete requirements first"
```

**Actual Result:**
```
Button state: _____
Disabled: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 3.2: Go Live Button Enabled (Ready)**

**Steps:**
1. Complete all requirements (score 80+)
2. Refresh page
3. Check button

**Expected Result:**
```
Button text: "🚀 Go Live Now"
Button enabled: true
Button class: ai-settings-btn-success
```

**Actual Result:**
```
Button state: _____
Enabled: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 3.3: Go Live Action**

**Steps:**
1. Click "🚀 Go Live Now"
2. Confirm action
3. Check database

**Expected Database Update:**
```javascript
db.companies.findOne({ _id: ObjectId("...") })

// Should show:
{
  configuration: {
    readiness: {
      isLive: true,              // ✅ Set to true
      goLiveAt: ISODate("..."),  // ✅ Timestamp
      goLiveBy: "admin@...",     // ✅ User who clicked
      score: 95,
      canGoLive: true
    }
  }
}
```

**Actual Result:**
```
isLive: _____
goLiveAt: _____
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 3.4: Already Live Status**

**Steps:**
1. After going live, refresh page
2. Check button

**Expected Result:**
```
Button text: "🟢 Live"
Button disabled: true
Button class: ai-settings-btn-secondary
Status banner: "🟢 Live! Your AI Agent is active and handling calls"
```

**Actual Result:**
```
Button shows live: [ ] YES [ ] NO
Banner updated: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

## 🧪 TEST 4: Integration Tests

**Goal:** Verify all components work together

### **Test 4.1: Urgency Keywords in Live Call**

**Steps:**
1. Ensure urgency keywords loaded (check Variables tab)
2. Make test call to: +1-239-561-4603
3. Say: "I have an emergency leak in my basement!"
4. Check backend logs

**Expected Logs:**
```
[V3 HYBRID BRAIN] Loaded 67 filler words, 12 urgency keywords
[URGENCY DETECTED] 
  keywords: leak(0.4), emergency(0.5)
  totalBoost: 0.9
  scenario: "Emergency Plumbing - Water Leaks"
```

**Actual Result:**
```
Keywords loaded: [ ] YES [ ] NO
Boost applied: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 4.2: Filler Words Filtering**

**Steps:**
1. Make test call
2. Say: "Um, like, I need, you know, some help with my, uh, AC"
3. Check backend logs

**Expected Logs:**
```
[V3 HYBRID BRAIN] Loaded 67 filler words
Original: "um like i need you know some help with my uh ac"
After filtering: "i need some help with my ac"
Matched scenario: "HVAC Support"
```

**Actual Result:**
```
Filler words removed: [ ] YES [ ] NO
Better match: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 4.3: Account Suspended Blocks Call**

**Steps:**
1. Set account to SUSPENDED
2. Make test call to company number
3. Listen to response

**Expected Result:**
```
Call connects
Message played: "This account is temporarily unavailable. Please try again later."
Call ends
Backend logs: [ACCOUNT STATUS] Call blocked - account suspended
```

**Actual Result:**
```
Call blocked: [ ] YES [ ] NO
Message correct: [ ] YES [ ] NO
```

**Status:** [ ] PASS [ ] FAIL

---

## 🧪 TEST 5: Performance Tests

**Goal:** Verify speed and caching

### **Test 5.1: Readiness Calculation Speed**

**Steps:**
1. Clear Redis cache
2. Call: `GET /api/company/{ID}/configuration/readiness`
3. Check response time

**Expected Result:**
```
First call (uncached): < 200ms
Second call (cached): < 50ms
Cache TTL: 30 seconds
```

**Actual Result:**
```
First call: _____ ms
Second call: _____ ms
```

**Status:** [ ] PASS [ ] FAIL

---

### **Test 5.2: Variable Validation Speed**

**Steps:**
1. Open Variables tab
2. Fill in all fields (8+ variables)
3. Click save (generate preview)
4. Measure time from click to modal

**Expected Result:**
```
Preview generation: < 500ms
Modal render: < 100ms
Total: < 600ms
```

**Actual Result:**
```
Total time: _____ ms
```

**Status:** [ ] PASS [ ] FAIL

---

## 📋 Test Summary

### **Results**

| Test | Status | Notes |
|------|--------|-------|
| 1.1 Empty Company | [ ] | |
| 1.2 Suspended Gatekeeper | [ ] | |
| 1.3 Call Forward | [ ] | |
| 1.4 Active Unblock | [ ] | |
| 1.5 Partial Config | [ ] | |
| 1.6 Full Config | [ ] | |
| 2.1 Preview Generation | [ ] | |
| 2.2 Countdown Timer | [ ] | |
| 2.3 Apply Success | [ ] | |
| 2.4 Token Expiry | [ ] | |
| 2.5 Idempotency | [ ] | |
| 2.6 Tampering Detection | [ ] | |
| 3.1 Button Disabled | [ ] | |
| 3.2 Button Enabled | [ ] | |
| 3.3 Go Live Action | [ ] | |
| 3.4 Already Live | [ ] | |
| 4.1 Urgency Keywords | [ ] | |
| 4.2 Filler Words | [ ] | |
| 4.3 Suspended Call | [ ] | |
| 5.1 Readiness Speed | [ ] | |
| 5.2 Validation Speed | [ ] | |

### **Pass Rate**

```
Total Tests: 21
Passed: _____ / 21
Failed: _____ / 21
Success Rate: _____% 
```

---

## 🐛 Bug Tracking

### **Bugs Found**

| # | Test | Severity | Description | Status |
|---|------|----------|-------------|--------|
| 1 | | | | [ ] Open [ ] Fixed |
| 2 | | | | [ ] Open [ ] Fixed |
| 3 | | | | [ ] Open [ ] Fixed |

---

## ✅ Sign-Off

**Tester:** _____________________  
**Date:** _____________________  
**Status:** [ ] APPROVED [ ] NEEDS WORK  

**Notes:**
```
_________________________________________________
_________________________________________________
_________________________________________________
```

---

## 🚀 Post-Testing Actions

### **If All Tests Pass:**
1. [ ] Update status to "Production Verified"
2. [ ] Create production deployment plan
3. [ ] Train support team
4. [ ] Enable for first pilot companies

### **If Tests Fail:**
1. [ ] Document all bugs in GitHub Issues
2. [ ] Prioritize critical bugs
3. [ ] Fix and re-test
4. [ ] Update documentation

---

**END OF CHECKLIST**

