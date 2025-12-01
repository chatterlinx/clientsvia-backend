# 🚀 ENABLE PRECISION FRONTLINE V23 - INSTRUCTIONS

**Date:** November 30, 2025  
**Purpose:** Switch all companies from LLM-0 to Precision Frontline V23  
**Status:** Ready to deploy

---

## 📋 WHAT THIS DOES

**Switches the AI routing system from:**
- **LLM-0** (slow, expensive, 1200ms, $0.003/turn)

**To:**
- **Precision Frontline V23** (fast, cheap, 361ms, $0.00011/turn)

---

## 🎯 TWO OPTIONS TO ENABLE

### **OPTION 1: Enable Via Production Server (RECOMMENDED)**

**1. SSH into Render container:**
```bash
# From Render dashboard:
# Services → clientsvia-backend → Shell
```

**2. Run the enablement script:**
```bash
node scripts/enable-precision-v23-all-companies.js
```

**3. Verify output:**
```
✅ Successfully Updated: X companies
LLM0_FULL → FRONTLINE_PRECISION_V23
```

**4. Restart the service (optional but recommended):**
```bash
# From Render dashboard:
# Manual Deploy → Clear build cache & deploy
```

---

### **OPTION 2: Enable Via MongoDB Directly**

**1. Connect to MongoDB Atlas:**
```bash
mongo "mongodb+srv://YOUR_CLUSTER_URL"
```

**2. Run this command:**
```javascript
use clientsvia;

db.companies.updateMany(
  {},  // All companies
  {
    $set: {
      'aiAgentSettings.orchestrationMode': 'FRONTLINE_PRECISION_V23'
    }
  }
);
```

**3. Verify:**
```javascript
db.companies.count({ 'aiAgentSettings.orchestrationMode': 'FRONTLINE_PRECISION_V23' });
```

---

## 🔍 HOW TO VERIFY IT'S WORKING

### **Method 1: Check Logs (Real-time)**

Make a test call to any company's Twilio number and watch for this log:

```
[V2 AGENT] 🚀 Using Precision Frontline-Intel V23
```

**NOT this:**
```
[V2 AGENT] 🧠 Using Legacy LLM-0 orchestration
```

### **Method 2: Check MongoDB**

```javascript
db.companies.findOne(
  { companyName: "YOUR_TEST_COMPANY" },
  { 'aiAgentSettings.orchestrationMode': 1 }
);

// Should return:
// { "aiAgentSettings": { "orchestrationMode": "FRONTLINE_PRECISION_V23" } }
```

### **Method 3: Check Response Times**

**Before (LLM-0):** 1200-1500ms per turn  
**After (Precision V23):** 350-500ms per turn

---

## 🚨 ROLLBACK INSTRUCTIONS

**If something goes wrong, switch back to LLM-0:**

```javascript
db.companies.updateMany(
  {},
  {
    $set: {
      'aiAgentSettings.orchestrationMode': 'LLM0_FULL'
    }
  }
);
```

---

## ✅ POST-ENABLEMENT CHECKLIST

1. **Test call to 3 different companies**
   - [ ] Logs show "Precision Frontline-Intel V23"
   - [ ] Response latency < 500ms
   - [ ] Routing accuracy is good

2. **Monitor for 24 hours**
   - [ ] No spike in errors
   - [ ] Cost per call drops to ~$0.00011
   - [ ] Customer satisfaction remains stable

3. **Review RoutingDecisionLog**
   - [ ] Check `models/routing/RoutingDecisionLog.js`
   - [ ] Query: `db.routingdecisionlogs.find().limit(10).sort({ timestamp: -1 })`
   - [ ] Look for routing accuracy

---

## 📊 EXPECTED RESULTS

| Metric | Before (LLM-0) | After (Precision V23) |
|--------|----------------|------------------------|
| **Latency** | 1200ms | 361ms |
| **Cost/Turn** | $0.003 | $0.00011 |
| **Accuracy (Day 1)** | 91% | 88-92% |
| **Accuracy (Week 2)** | 91% | 97-99% |
| **Personalization** | None | Full |
| **Emotion Detection** | None | Active |

---

## 🎯 CURRENT STATUS

**As of Nov 30, 2025:**
- ✅ Precision V23 code is deployed to GitHub
- ✅ Production server has latest code
- ❌ **NOT enabled for any company yet** (still using LLM-0)

**To activate:** Follow Option 1 or Option 2 above.

---

**Questions? Check the full audit:**  
`LLM-0-VS-PRECISION-V23-AUDIT.md`


