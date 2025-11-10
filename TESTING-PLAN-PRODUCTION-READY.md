# 🧪 PRODUCTION TESTING PLAN - FINAL LEGACY SWEEP

**Last Updated:** November 10, 2025  
**Status:** Ready for Testing  
**Version:** 1.0

---

## 🚀 PRE-TEST DEPLOYMENT

### **Step 1: Deploy to Render**
```bash
# Your code is committed and pushed:
git log --oneline -5

# Render should auto-deploy from main
# Monitor deployment at: https://dashboard.render.com/
# Wait for deployment to complete (3-5 minutes)
```

**Verify deployment:**
- [ ] Check Render deployment logs
- [ ] Confirm no errors during build
- [ ] Service should show "Live"

---

## 🧪 TEST 1: Verify NO Generic Fallback Text

### **Scenario: Normal AI Response**
1. Call test Twilio number
2. Wait for greeting (should be ElevenLabs voice)
3. Say: "What are your hours?"
4. **Expected:** Exact response from scenario (NOT "I understand...")
5. **Check logs for:** ✅ AI Brain match, ✅ Tier used, ❌ NO generic text

### **Scenario: AI Brain Successful**
```
✅ User hears: Exact answer from scenario
✅ ElevenLabs voice plays response
✅ Logs show: Tier 1/2/3 match found
❌ NO: "I'm here to help" or "I understand"
```

---

## 🧪 TEST 2: Verify Infrastructure Fallback (Hybrid)

### **Scenario: Simulate ElevenLabs Failure**
1. Modify `.env` to set invalid ElevenLabs API key temporarily
2. Call test number
3. Greeting should fail → Infrastructure fallback triggered
4. **Expected behavior:**
   - ✅ SMS sent to you: "We're experiencing technical issues..."
   - ✅ Admin alert (CRITICAL) in system
   - ✅ Call transfers to human agent
   - ❌ NO generic voice message playing

### **Check logs for:**
```
🚨 [INFRASTRUCTURE FAILURE] Triggering fallback
✅ [FALLBACK] SMS sent successfully
✅ [ADMIN ALERT] CRITICAL alert sent - ops team notified
✅ [FALLBACK] Infrastructure failure response complete - transferring to human
```

---

## 🧪 TEST 3: Verify NO Personality Tone Injection

### **Scenario: Check Response Purity**
1. Create a scenario with specific response: "Business hours are 9-5"
2. Have user ask about hours
3. **Expected:** Exact response: "Business hours are 9-5"
4. **NOT:** "I understand you need that info. Business hours are 9-5"

### **Check logs:**
```
✅ V2 RESPONSE: Generated response from scenario
✅ No applyV2PersonalityTone() call in logs
✅ No personality framework applied
```

---

## 🧪 TEST 4: Verify Configuration Error Handling

### **Scenario: Disable AI Agent**
1. Go to admin panel
2. Disable "V2 AI Agent Logic" for test company
3. Call test number
4. **Expected:**
   - ✅ Call transfers immediately
   - ✅ No generic error message
   - ✅ Logs show: transfer action taken

### **Check logs for:**
```
✅ [V2 AGENT] AI Agent Logic is disabled
✅ Configuration error → Transfer to human
❌ NO: "I'm sorry, there's a configuration issue"
```

---

## 🧪 TEST 5: Verify Suspended Account Handling

### **Scenario: Suspend Company Account**
1. Suspend test company in admin
2. Call test number
3. **Expected:**
   - ✅ Neutral message: "This service is unavailable. Please contact support."
   - ✅ Call hangs up
   - ❌ NO: "We're sorry, service is temporarily unavailable..."

---

## 🧪 TEST 6: Verify Transfer Messages are Neutral

### **Scenario: Trigger Transfer**
1. Create a scenario that transfers (e.g., "billing")
2. User asks about billing
3. **Expected:** System plays configured transfer message
4. **Not:** "I apologize, but I cannot transfer..."

### **Check logs for:**
```
✅ TRANSFER MESSAGE: "I'm connecting you to our team." (or custom)
❌ NO: "I apologize" or generic apology messages
```

---

## 📊 LOGGING VERIFICATION

### **What to Look For in Logs:**

#### ✅ GOOD INDICATORS:
```
✅ [V2 GREETING] 🎭 Generating greeting
✅ [TTS COMPLETE] ✅ Using ElevenLabs voice
✅ [INTELLIGENT ROUTER] Starting 3-tier cascade
✅ [TIER 1] Rule-based match succeeded
✅ V2 ELEVENLABS: Using voice [voiceId]
✅ [FALLBACK] Infrastructure failure response complete
```

#### ❌ BAD INDICATORS (If you see these, something's wrong):
```
❌ "I'm here to help" in response
❌ "I understand you have" in logs
❌ applyV2PersonalityTone in logs
❌ aiResponseSuggestionService referenced
❌ "I apologize, but I cannot"
❌ V2 ELEVENLABS: Failed (this means Redis unavailable - use disk fallback)
```

---

## 🔍 DETAILED TEST CASE: Complete Call Flow

### **Step-by-Step:**

1. **DIAL** your company's Twilio number
   ```
   Expected: Ring, then...
   ```

2. **HEAR GREETING**
   ```
   Expected: ElevenLabs voice (natural, not robotic)
   Check: No generic "Welcome to our system"
   ```

3. **SAY YOUR QUESTION**
   ```
   Say: "What are your hours?"
   Expected: System listens and recognizes
   ```

4. **HEAR RESPONSE**
   ```
   Expected: EXACT scenario response
   Example: "We're open Monday to Friday, 9 AM to 6 PM"
   NOT: "I understand you asked about hours. We're open..."
   ```

5. **LISTEN TO VOICE**
   ```
   Expected: Smooth ElevenLabs TTS
   NOT: Robotic Twilio voice
   ```

6. **CONTINUE OR HANGUP**
   ```
   If continue: Gather next input
   If no response: Timeout → hangup
   ```

---

## 📝 TEST LOG TEMPLATE

### **Copy this template to verify each test:**

```
TEST: [Test Name]
DATE: [Date/Time]
COMPANY: [Test Company]
TWILIO: [Test Number]

BEFORE CALL:
- [ ] Render deployed successfully
- [ ] Test company configured
- [ ] Scenarios loaded

DURING CALL:
- [ ] Greeting played ✅/❌
- [ ] Voice is ElevenLabs ✅/❌
- [ ] No generic fallback text ✅/❌
- [ ] Transfer worked properly ✅/❌

LOGS CHECKED:
- [ ] AI Brain matched scenario
- [ ] Correct tier used (1/2/3)
- [ ] No personality tone applied
- [ ] Response is pure (no prefixes)

RESULT:
✅ PASS / ❌ FAIL

NOTES:
[Any issues or observations]
```

---

## 🚨 CRITICAL TESTS - DO THESE FIRST

### **MUST PASS:**
1. ✅ Normal scenario response (no generic text)
2. ✅ Infrastructure fallback (SMS + Alert + Transfer)
3. ✅ No personality tone injection
4. ✅ Transfer message is neutral

### **NICE TO VERIFY:**
5. ✅ Configuration error handling
6. ✅ Suspended account handling
7. ✅ ElevenLabs voice consistency

---

## 🎯 SUCCESS CRITERIA

Your system is PRODUCTION READY when:

- [ ] **NO generic fallback text** appears in any response
- [ ] **Infrastructure failures** trigger SMS + Alert + Transfer
- [ ] **Scenario responses** are exact (no prefixes added)
- [ ] **ElevenLabs voice** plays consistently
- [ ] **Transfer messages** are neutral and professional
- [ ] **All logs** show clean flow (no personality framework)
- [ ] **Personality module** is completely gone
- [ ] **AIBrain3tierllm** is sole knowledge source

---

## 📞 QUICK TEST CALL

### **Fastest way to verify everything works:**

```bash
# 1. Deployment complete?
Check Render: https://dashboard.render.com/

# 2. Call your test number
# Dial from any phone

# 3. Listen carefully
- Greeting should be natural ElevenLabs voice
- NO generic "Welcome to our system" text
- Response should be EXACT scenario text

# 4. Check logs
# Search for: "V2 RESPONSE" or "ELEVENLABS"
# Should see: Tier match, ElevenLabs voice ID, response text
# Should NOT see: "I understand", "personality", "apology"

# 5. Result?
✅ If no generic text → SUCCESS
❌ If you hear generic text → NEED TO FIX
```

---

## 🆘 TROUBLESHOOTING

### **If you hear "I understand..." or generic text:**
- [ ] Check Render deployment completed
- [ ] Verify code is latest (check git log)
- [ ] Clear browser cache if admin changes
- [ ] Restart Render service

### **If ElevenLabs fails (uses Twilio voice):**
- [ ] Check Redis connection (might be disk fallback)
- [ ] Verify API key is set in environment
- [ ] Check ElevenLabs account has quota
- [ ] Logs will show: "⚠️ Redis unavailable, using disk fallback"

### **If infrastructure fallback doesn't send SMS:**
- [ ] Verify SMS service is configured
- [ ] Check admin notification settings
- [ ] Look for SMS in logs: "[FALLBACK] SMS sent"
- [ ] Check if SMS was throttled

---

## ✅ CHECKLIST - READY FOR PRODUCTION?

```
CODEBASE:
- [ ] All generic fallback text removed
- [ ] Personality module deleted
- [ ] AIBrain3tierllm is sole knowledge source
- [ ] Infrastructure fallback is hybrid (SMS + Alert + Transfer)
- [ ] All commits pushed to main

DEPLOYMENT:
- [ ] Render shows "Live" status
- [ ] Logs show no errors
- [ ] Services are responding

TESTING:
- [ ] Normal response has NO generic text
- [ ] Transfer message is neutral
- [ ] Infrastructure failure triggers SMS + Alert
- [ ] Configuration error triggers transfer
- [ ] ElevenLabs voice is consistent

RESULT:
[ ] ✅ ALL PASS - READY FOR PRODUCTION
[ ] ❌ SOME ISSUES - NEED TO FIX
```

---

**GOOD LUCK! Let me know what you find during testing!** 🚀

