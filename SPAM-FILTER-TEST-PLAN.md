# 🧪 SPAM FILTER TEST EXECUTION PLAN

**Date**: November 27, 2025  
**Tester**: Marc + AI Coder  
**Test Company**: Royal HVAC  
**Company ID**: `68e3f77a9d623b8058c700c4`  
**Phone Number**: `+12392322030`

---

## 🎯 TEST OBJECTIVE

Verify that SmartCallFilter correctly blocks/allows calls on BOTH routes:
1. `/api/twilio/voice` (main route)
2. `/api/twilio/voice/:companyID` (deprecated but now secured)

---

## 🧪 TEST 1: CLEAN NUMBER (Expected: ALLOW)

### Setup:
- Use a phone number NOT in any database
- Test Number: `+15551234567` (or your actual test phone)

### Steps:
1. Call `+12392322030` from clean number
2. Listen for greeting (should play)
3. Check logs immediately

### Expected Results:
- ✅ Call goes through
- ✅ Greeting plays (ElevenLabs voice)
- ✅ Log shows:
  ```
  [SPAM-FIREWALL] decision {
    route: '/voice',
    decision: 'ALLOW',
    reason: null,
    ...
  }
  ```
- ✅ NO BlockedCallLog entry created
- ✅ Call continues to AI Agent

### Actual Results:
```
[TO BE FILLED IN DURING TEST]

CallSid: 
Decision: 
Outcome: 
Log Line: 


```

---

## 🧪 TEST 2: COMPANY BLACKLIST (Expected: BLOCK)

### Setup:
1. Add test number to Royal HVAC blacklist via Admin UI:
   - Go to: Company Profile → Spam Filter tab
   - Click: "Add to Blacklist"
   - Enter: `+15551234567`
   - Reason: "Test spam number"
   - Save

2. Verify in database:
   ```javascript
   db.companies.findOne(
     { _id: ObjectId("68e3f77a9d623b8058c700c4") },
     { "callFiltering.blacklist": 1 }
   )
   ```

### Steps:
1. Call `+12392322030` from blacklisted number
2. Listen for block message
3. Check logs immediately
4. Verify BlockedCallLog entry

### Expected Results:
- ✅ Call blocked immediately
- ✅ Hear: "This call has been blocked. Goodbye."
- ✅ Call hangs up
- ✅ Log shows:
  ```
  [SPAM-FIREWALL] decision {
    route: '/voice',
    decision: 'BLOCK',
    reason: 'company_blacklist',
    ...
  }
  ```
- ✅ BlockedCallLog entry created:
  ```javascript
  {
    callerPhone: "+15551234567",
    companyId: "68e3f77a9d623b8058c700c4",
    blockReason: "company_blacklist",
    detectionMethod: "manual",
    timestamp: ISODate("...")
  }
  ```
- ✅ Spam Filter UI shows blocked call in log
- ✅ Counter increments

### Actual Results:
```
[TO BE FILLED IN DURING TEST]

CallSid: 
Decision: 
Block Message Heard: 
Log Line: 


BlockedCallLog Entry:


UI Updated: 
```

---

## 🧪 TEST 3: GLOBAL SPAM DATABASE (Expected: BLOCK)

### Setup:
1. Insert test number into GlobalSpamDatabase collection:
   ```javascript
   db.globalspamdata.insertOne({
     phoneNumber: "+15559999999",
     spamType: "robocall",
     spamScore: 95,
     reports: {
       count: 50,
       lastReportedAt: new Date(),
       reportedBy: ["test-company-1", "test-company-2"]
     },
     metadata: {
       category: "test_spam",
       notes: "Test number for spam filter validation"
     },
     createdAt: new Date(),
     updatedAt: new Date()
   })
   ```

2. Verify insertion:
   ```javascript
   db.globalspamdata.findOne({ phoneNumber: "+15559999999" })
   ```

### Steps:
1. Call `+12392322030` from spam number `+15559999999`
2. Listen for block message
3. Check logs immediately
4. Verify BlockedCallLog entry

### Expected Results:
- ✅ Call blocked immediately (before company blacklist check)
- ✅ Hear: "This call has been blocked. Goodbye."
- ✅ Call hangs up
- ✅ Log shows:
  ```
  [SPAM-FIREWALL] decision {
    route: '/voice',
    decision: 'BLOCK',
    reason: 'known_spammer',
    ...
  }
  ```
- ✅ BlockedCallLog entry created:
  ```javascript
  {
    callerPhone: "+15559999999",
    companyId: "68e3f77a9d623b8058c700c4",
    blockReason: "known_spammer",
    blockReasonDetails: "Spam score: 95",
    spamScore: 95,
    detectionMethod: "database",
    timestamp: ISODate("...")
  }
  ```

### Actual Results:
```
[TO BE FILLED IN DURING TEST]

CallSid: 
Decision: 
Block Message Heard: 
Log Line: 


BlockedCallLog Entry:


```

---

## 🧪 BONUS TEST 4: DEPRECATED ROUTE (Expected: BLOCK on spam)

### Setup:
- Keep test number in company blacklist from Test 2
- Temporarily update Twilio webhook to use `/voice/:companyID` format:
  - URL: `https://your-domain.com/api/twilio/voice/68e3f77a9d623b8058c700c4`

### Steps:
1. Call `+12392322030` from blacklisted number
2. Check logs for deprecation warning
3. Verify block still works

### Expected Results:
- ✅ Deprecation warning in logs:
  ```
  ⚠️ [TWILIO] DEPRECATED ROUTE USED: /voice/:companyID {
    companyId: '68e3f77a9d623b8058c700c4',
    message: 'This route is deprecated...'
  }
  ```
- ✅ Spam filter still blocks:
  ```
  [SPAM-FIREWALL] decision {
    route: '/voice/:companyID',
    decision: 'BLOCK',
    reason: 'company_blacklist',
    ...
  }
  ```
- ✅ BlockedCallLog entry created
- ✅ Call hangs up with block message

### Actual Results:
```
[TO BE FILLED IN DURING TEST]

Deprecation Warning Seen: 
Spam Filter Worked: 
CallSid: 
Log Lines:


```

**IMPORTANT**: After this test, change Twilio webhook BACK to `/voice` (without companyID).

---

## 📊 TEST EXECUTION CHECKLIST

### Pre-Test Setup:
- [ ] Verify Royal HVAC exists in database
- [ ] Verify phone number `+12392322030` is configured for Royal HVAC
- [ ] Verify Twilio webhook points to correct endpoint
- [ ] Clear any existing test numbers from blacklist
- [ ] Have access to:
  - MongoDB console (to verify writes)
  - Application logs (to see [SPAM-FIREWALL] logs)
  - Spam Filter UI (to verify counters)
  - Phone to make test calls

### During Testing:
- [ ] Run Test 1 (Clean Number - ALLOW)
- [ ] Run Test 2 (Company Blacklist - BLOCK)
- [ ] Run Test 3 (Global Spam DB - BLOCK)
- [ ] (Optional) Run Test 4 (Deprecated Route)

### Post-Test Verification:
- [ ] All [SPAM-FIREWALL] logs captured
- [ ] All BlockedCallLog entries verified in MongoDB
- [ ] Spam Filter UI shows correct blocked call count
- [ ] No errors in application logs
- [ ] Cleanup: Remove test numbers from databases

---

## 📋 SUCCESS CRITERIA

**PASS if**:
- ✅ Test 1: Clean number allowed, greeting plays
- ✅ Test 2: Blacklisted number blocked, log entry created
- ✅ Test 3: Global spam number blocked at Layer 1
- ✅ All [SPAM-FIREWALL] logs show correct decision/reason
- ✅ BlockedCallLog writes correctly
- ✅ UI updates correctly

**FAIL if**:
- ❌ Any spam call goes through
- ❌ Clean call gets blocked (false positive)
- ❌ Logs missing or incorrect
- ❌ Database writes fail
- ❌ Errors in application logs

---

## 🎯 AFTER TESTS PASS

Once all tests pass:

1. **Document Results**: Fill in "Actual Results" sections above
2. **Update Audit**: Mark tests as complete in `AUDIT-SPAM-FILTER-WIRING-2025-11-27.md`
3. **Cleanup**: Remove test spam numbers from databases
4. **Monitor**: Watch logs for `/voice/:companyID` usage over next 2 weeks
5. **Next Step**: Move to **STEP 1: Greeting + <Gather> Wiring Audit**

---

## 🚨 IF TESTS FAIL

If any test fails:

1. **DO NOT PROCEED** to next step
2. **Capture**:
   - Exact log output
   - Database state
   - TwiML response
   - Error messages
3. **Report** to Marc with all details
4. **Fix** issue before moving forward

---

**Test execution can begin once Marc approves.**

---

_Test Plan Created By: AI Coder (World-Class)_  
_Ready for Execution: YES_  
_Estimated Time: 15-20 minutes_

