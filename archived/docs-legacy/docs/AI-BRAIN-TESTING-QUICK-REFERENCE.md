# 🎯 AI BRAIN TESTING - QUICK REFERENCE CARD

**Print this or keep it visible during testing**

---

## 🚀 **SETUP (DO FIRST!)**

1. **Render Dashboard:** https://dashboard.render.com
2. **Add Environment Variables:**
   ```
   ENABLE_3_TIER_INTELLIGENCE=true
   OPENAI_API_KEY=sk-...your-key...
   ```
3. **Wait 2 minutes** for deployment
4. **Verify in logs:** `✅ 3-Tier Intelligence System: ENABLED`

---

## 📞 **TEST CALL SCRIPTS**

### **✅ TIER 1 TESTS (Should be FREE & FAST - <100ms)**

| Say This | Should Match | Tier | Cost |
|----------|--------------|------|------|
| "I need to schedule an appointment" | Appointment Booking | 1 | $0.00 |
| "My AC is not cooling" | AC Not Cooling | 1 | $0.00 |
| "Emergency! My system is leaking!" | Emergency Service | 1 | $0.00 |
| "What are your hours?" | Business Hours | 1 | $0.00 |

---

### **⚠️ TIER 2 TESTS (Should be FREE & MEDIUM - <200ms)**

| Say This | Should Match | Tier | Cost |
|----------|--------------|------|------|
| "Can someone come look at my system tomorrow?" | Service Request | 2 | $0.00 |
| "I think my thermostat is broken" | Thermostat Issues | 2 | $0.00 |
| "My house is not getting cool" | AC Not Cooling | 2 | $0.00 |

---

### **🤖 TIER 3 TESTS (Should use LLM - <3000ms)**

| Say This | Expected Result | Cost |
|----------|-----------------|------|
| "Does my warranty cover a compressor replacement if the unit is 8 years old?" | LLM handles intelligently | $0.02-0.05 |
| "My thingy on the wall is not working" | LLM learns "thingy" = "thermostat" | $0.02-0.05 |
| "Yeah, so like, I was wondering if someone could come out today because my AC is making this weird noise and also I wanted to know if you guys service Carrier brand units?" | LLM extracts multiple intents + fillers | $0.02-0.05 |

---

## 📊 **WHAT TO CHECK AFTER EACH CALL**

### **In Test Call Log:**
- [ ] Tier Used (1, 2, or 3)
- [ ] Confidence Score (0.00-1.00)
- [ ] Response Time (ms)
- [ ] Cost ($0.00 or $0.02+)
- [ ] Scenario Matched
- [ ] Patterns Learned (if Tier 3)

### **In Console (F12):**
```javascript
// Tier 1 Success:
✅ [TIER 1] Rule-based match succeeded
   confidence: 0.92
   responseTime: 54ms
   cost: $0.00

// Tier 2 Success:
✅ [TIER 2] Semantic match succeeded
   confidence: 0.72
   responseTime: 142ms
   cost: $0.00

// Tier 3 Success:
✅ [TIER 3 LLM] Analysis complete
   confidence: 0.87
   patternsExtracted: 2
   cost: $0.0125
   responseTime: 1543ms
🧠 [LEARNING] Patterns applied to Tier 1
```

---

## 🟣 **AI SUGGESTIONS CHECK**

### **After 5-10 LLM Calls:**
1. Go to Global AI Brain
2. Look at purple section at top
3. Should show:
   - [ ] Total suggestions count
   - [ ] Priority breakdown (High/Medium/Low)
   - [ ] Suggestion cards

### **Click "View Analysis" to see:**
- [ ] Call transcripts
- [ ] LLM reasoning
- [ ] Impact metrics
- [ ] Suggested keywords/synonyms

### **Click "Apply" to:**
- [ ] Add pattern to template
- [ ] Remove suggestion from list
- [ ] Verify notification sent

---

## 🔔 **NOTIFICATION CENTER CHECK**

### **Should See These Alerts:**
- [ ] `AI_LEARNING_PATTERN_LEARNED` (INFO)
- [ ] `AI_LEARNING_SYNONYM_ADDED` (INFO)
- [ ] `AI_LEARNING_FILLER_ADDED` (INFO)
- [ ] `AI_LEARNING_KEYWORD_ADDED` (INFO)

### **Should NOT See (unless errors):**
- [ ] `AI_TIER3_LLM_FAILURE` (CRITICAL)
- [ ] `OPENAI_API_ERROR` (CRITICAL)
- [ ] `AI_TIER3_RESPONSE_SLOW` (WARNING)

---

## ⏱️ **PERFORMANCE TARGETS**

| Tier | Target Time | Max Time | Cost |
|------|-------------|----------|------|
| Tier 1 | 50-80ms | 100ms | $0.00 |
| Tier 2 | 100-150ms | 200ms | $0.00 |
| Tier 3 | 1000-2000ms | 3000ms | $0.02-0.05 |

---

## 🧪 **PATTERN LEARNING TEST (CRITICAL!)**

### **Test 1 (First Time - Should use LLM):**
- Say: "My thingy on the wall is not working"
- Expected: Tier 3 (LLM), Cost: $0.02-0.05
- LLM learns: "thingy" = "thermostat"

### **Wait 30 seconds**

### **Test 2 (Second Time - Should use Tier 1!):**
- Say: "My thingy on the wall is not working" (SAME PHRASE)
- Expected: Tier 1 (FREE!), Cost: $0.00
- **THIS PROVES LEARNING WORKS!** ✅

---

## 🆘 **TROUBLESHOOTING**

### **Problem: OpenAI Not Working**
- Check `OPENAI_API_KEY` is set correctly
- Check OpenAI account has credits
- Visit: https://status.openai.com

### **Problem: LLM Never Being Called**
- Check `ENABLE_3_TIER_INTELLIGENCE=true`
- Check console for Tier 1/2 confidence scores
- Try a query NO scenario can match

### **Problem: Suggestions Not Showing**
- Make at least 5 LLM calls first
- Click "Refresh" button
- Open console (F12), check for errors

### **Problem: Slow Responses**
- Check network connectivity
- Check OpenAI API status
- Check Render logs for errors

---

## ✅ **SUCCESS CRITERIA**

### **Before Declaring "Production Ready":**
- [ ] All 3 tiers work correctly
- [ ] Pattern learning is functioning
- [ ] AI suggestions are generated
- [ ] Suggestions can be applied
- [ ] Notifications are firing
- [ ] Cost tracking is accurate
- [ ] Voice quality is excellent
- [ ] Customer experience is smooth

---

## 📈 **COST EXPECTATIONS**

### **Week 1 (Learning Phase):**
- Tier 1: 50% (FREE)
- Tier 2: 20% (FREE)
- Tier 3: 30% (PAID)
- Average: **$0.15/call**

### **Week 4 (Optimized):**
- Tier 1: 75% (FREE)
- Tier 2: 18% (FREE)
- Tier 3: 7% (PAID)
- Average: **$0.04/call**

### **Week 12 (Fully Learned):**
- Tier 1: 90% (FREE)
- Tier 2: 8% (FREE)
- Tier 3: 2% (PAID)
- Average: **$0.01/call**

---

## 🎯 **TESTING ORDER**

1. ✅ **Health Check** (5 min) - Verify OpenAI connected
2. ✅ **Tier 1 Tests** (10 min) - Verify rule-based works
3. ✅ **Tier 2 Tests** (10 min) - Verify semantic works
4. ✅ **Tier 3 Tests** (15 min) - Verify LLM works & learns
5. ✅ **Pattern Learning** (10 min) - Verify learning cycle
6. ✅ **AI Suggestions** (15 min) - Verify suggestions generated
7. ✅ **Customer Experience** (15 min) - Call as a real customer

**Total Time: ~90 minutes for complete testing**

---

## 📞 **READY TO TEST?**

**Test Pilot Number:** `[YOUR_TEST_NUMBER]`

**URLs:**
- Global AI Brain: `https://[your-domain]/admin-global-instant-responses.html`
- Notification Center: `https://[your-domain]/admin-notification-center.html`
- Render Dashboard: `https://dashboard.render.com`

---

**🚀 Let's build the most intelligent AI system ever!**

