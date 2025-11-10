# 📘 Onboarding Playbook – Ship Quality Scenarios

**Purpose:** Repeatable process to ensure every new client gets a working AI receptionist, not a broken one. Data quality starts here.

---

## 🎯 Overview

Bad scenarios → bad AI → angry clients. This playbook prevents that.

**Duration:** 1-2 weeks per new client  
**Outcome:** Live, proven AI receptionist  
**Owner:** Onboarding specialist (non-technical customer success)

---

## 📋 Checklist: Pre-Onboarding

Before the customer is handed to onboarding:

- [ ] Company account created in admin UI
- [ ] Company has a Twilio phone number assigned
- [ ] Customer has admin access to their company settings
- [ ] Customer has been sent this playbook (PDF or Notion doc)

---

## 🔄 Phase 1: Discovery (Day 1)

**Goal:** Map what their AI receptionist needs to handle.

### 1.1 Discovery Call (30 min)

Schedule a call with the customer's office manager or business owner.

**Script:**

> "We're going to figure out the top 10 things callers ask for, so your AI can handle them perfectly. By the end of this call, we'll have a list of scenarios we'll teach your AI."

**Questions to ask:**

1. What are the most common reasons people call you?
2. For each reason, what should the AI say/do?
3. Should the AI book appointments? Transfer to a human? Just provide info?
4. What hours are you open?
5. What's your cancellation policy?
6. Do you have pricing information you want callers to know?
7. What's the #1 thing that frustrates your current phone system?

**Document:** Fill out `CUSTOMER_SCENARIO_MAP.csv`

```csv
"Rank","Call Reason","What AI Should Do","Info to Provide","Type","Strategy"
"1","What are your hours?","Provide info","Mon-Fri 8-6, Sat 9-2","INFO_FAQ","AUTO"
"2","I want to book an appointment","Confirm time, collect info","Collect name + phone","ACTION_FLOW","AUTO"
"3","What's your pricing?","Provide info","Standard service $50/hr","INFO_FAQ","AUTO"
"4","Can I speak to someone?","Transfer to human","N/A","SYSTEM_ACK","AUTO"
"5","Thank you","Acknowledge","'You're welcome!'","SMALL_TALK","AUTO"
```

---

## 🧩 Phase 2: Template Build (Day 2-3)

**Goal:** Create scenarios in your admin UI using the scenario map.

### 2.1 Default Scenario Template

For each call reason, create a scenario with:

**Required Fields:**

| Field | Example | Notes |
|-------|---------|-------|
| Scenario Name | "Hours of Operation" | Clear, searchable |
| Scenario Type | INFO_FAQ | From list: INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK |
| Reply Strategy | AUTO | Use AUTO (default) unless customer has specific request |
| Triggers (5-10) | "What are your hours?", "When are you open?", "Do you work weekends?" | Customer's actual phrases |
| Quick Replies (2-3) | "Great question! Here's our schedule.", "We're happy to share that." | Greeting before full info |
| Full Replies (2-3) | "We're open Monday through Friday, 8am to 6pm, and Saturday 9am to 2pm. We're closed Sundays and holidays." | Complete, detailed response |

### 2.2 Starter Scenario Pack

You provide this template for every new customer:

```yaml
Scenario 1: Hours of Operation (INFO_FAQ)
  Triggers:
    - What are your hours?
    - When are you open?
    - Do you work weekends?
    - What's your schedule?
  Quick Replies:
    - Great question! Let me share our hours with you.
    - I'm happy to help with that.
  Full Replies:
    - We're open Monday through Friday from 8am to 6pm, Saturday 9am to 2pm. We're closed Sundays and all major holidays.

Scenario 2: Book an Appointment (ACTION_FLOW)
  Triggers:
    - I'd like to book an appointment
    - Can I schedule a time with you?
    - Do you have any availability?
    - I want to make an appointment
  Quick Replies:
    - Absolutely! I can help you get scheduled.
    - Let's find a time that works for you.
  Full Replies:
    - Great! I'd be happy to schedule you. What day works best for you?

Scenario 3: Pricing (INFO_FAQ)
  Triggers:
    - What's your pricing?
    - How much do you charge?
    - What are your rates?
    - Do you have pricing information?
  Quick Replies:
    - Good question! Here's our pricing.
  Full Replies:
    - Our standard service is $50 per hour. We also offer package rates for longer projects. Would you like more details?

Scenario 4: Transfer to Human (ACTION_FLOW)
  Triggers:
    - Can I speak to someone?
    - I'd like to talk to a real person
    - Can you transfer me?
    - Put me through to an agent
  Quick Replies:
    - Of course! Let me connect you.
  Full Replies:
    - Absolutely, I'll transfer you to one of our team members right now.

Scenario 5: Greeting (SMALL_TALK)
  Triggers:
    - Hello
    - Hi there
    - Hey
  Quick Replies:
    - Hi! Thanks for calling. How can I help?
    - Hello! What can I do for you?

Scenario 6: Goodbye (SMALL_TALK)
  Triggers:
    - Thanks
    - Thank you
    - Goodbye
    - Thanks for your help
  Quick Replies:
    - You're welcome! Glad I could help.
    - Anytime! Have a great day.
```

### 2.3 Admin Setup Walkthrough (15 min video call)

Walk customer through creating their first scenario:

1. Show them logging into admin panel
2. Navigate to "Global Instant Responses" → "Create Scenario"
3. Fill out:
   - Scenario Name: "Hours of Operation"
   - Scenario Type: INFO_FAQ
   - Reply Strategy: AUTO
   - Triggers: Copy from template
   - Full Replies: Copy from template
4. Save
5. Create 2-3 more together

Give them the template CSV and say:

> "Use this as your checklist. For the next 24 hours, go through and create all 6 of these scenarios. Use the wording we discussed, and don't worry about perfection—we'll test and refine."

---

## 🧪 Phase 3: Dry Run Testing (Day 4)

**Goal:** Catch broken scenarios before going live.

### 3.1 You Test Their Scenarios

Using internal test numbers, call their number and ask:

1. "What are your hours?" → Should get full hours info
2. "I want to book an appointment" → Should offer booking
3. "What's your pricing?" → Should give pricing
4. "Can I speak to someone?" → Should offer transfer
5. "Thank you" → Should say you're welcome

### 3.2 The Trace Report

Use the Call Trace UI to show them:

```
✅ PASS: "What are your hours?"
  • Matched scenario: Hours of Operation
  • Type: INFO_FAQ (correct)
  • Strategy: FULL_ONLY (correct)
  • Response: [Full hours text]
  • AI Confidence: 0.92

✅ PASS: "I want to book an appointment"
  • Matched scenario: Book Appointment
  • Type: ACTION_FLOW (correct)
  • Strategy: QUICK_THEN_FULL (correct)
  • Response: [Quick intro + Full guidance]

❌ FAIL: "Can I speak to someone?"
  • Matched scenario: ??? (NO MATCH)
  • Confidence: 0.31 (too low)
  • Action: Escalated to human
  • FIX: Add more trigger phrases like "agent", "representative", "speak to someone"
```

### 3.3 Fixes

For any failures:

1. Identify the broken scenario or missing triggers
2. Edit the scenario in admin
3. Re-test
4. Show them the new trace (proof of fix)

Repeat until 5/5 scenarios pass.

---

## ✅ Phase 4: Go Live (Day 5+)

### 4.1 Soft Launch (Optional)

If customer is nervous, do a phased rollout:

1. Enable AI for 10% of calls (9am-10am)
2. Monitor traces and metrics
3. Day 2: 25% (business hours)
4. Day 3: 50%
5. Day 4: 100%

### 4.2 Full Launch

Enable AI for 100% of calls.

Send customer:

> "Your AI receptionist is live! Here's your dashboard link to see call metrics in real-time."

Link: `https://yourplatform.com/dashboard/company/[companyId]`

---

## 📊 Phase 5: 7-Day Review (Day 12)

### 5.1 Review Meeting (30 min)

Pull up their monitoring dashboard:

```
Period: Last 7 days

Metrics:
  • Total calls: 142
  • AI handled: 127 (89%)
  • Escalated: 15 (11%)
  • Avg response time: 450ms

Top scenarios:
  1. Hours - 67 calls, 0 escalations ✓
  2. Booking - 34 calls, 8 escalations ⚠
  3. Pricing - 18 calls, 0 escalations ✓

Issues found:
  • "Booking" scenario has high escalation (8/34 = 24%)
     → Look at traces for "booking" failures
     → Add more trigger phrases: "reserve", "schedule", "get me in"
     → Improve full reply to be more clear about process
```

### 5.2 Iterative Improvements

For any scenario with >15% escalation:

1. Pull top 5 Call Traces for that scenario
2. Show customer what callers said vs what AI responded
3. Ask: "Is the AI response right, or should it be different?"
4. Fix together

---

## 📚 Customer Documentation

Provide every customer with a PDF packet:

### **"Your AI Receptionist Setup Guide"**

Includes:

1. **Scenario Checklist**
   - [ ] Hours of Operation (INFO_FAQ)
   - [ ] Book Appointment (ACTION_FLOW)
   - [ ] Pricing Info (INFO_FAQ)
   - [ ] Transfer Request (ACTION_FLOW)
   - [ ] Greeting (SMALL_TALK)
   - [ ] Thank You (SMALL_TALK)

2. **Best Practices for Scenarios**
   - ✅ DO: Write full replies as you would speak them (friendly, complete)
   - ❌ DON'T: Write ultra-short responses ("Yes" or "Click here")
   - ✅ DO: Include 5-10 trigger phrases per scenario
   - ❌ DON'T: Use ambiguous phrases that match multiple scenarios
   - ✅ DO: Set Scenario Type (INFO_FAQ vs ACTION_FLOW)
   - ❌ DON'T: Leave Reply Strategy as default unless you know what you're doing

3. **Monitoring Your AI**
   - Dashboard link
   - How to read the metrics
   - What escalation rate means
   - When to contact support

4. **Troubleshooting**
   - "AI keeps asking for info I already said" → Add more triggers
   - "AI gives wrong answer" → Edit the full reply text
   - "AI isn't picking up certain calls" → Check scenario triggers
   - "AI takes too long to respond" → This is normal (450ms avg)

---

## 🎓 Success Criteria

After 7 days, customer is "onboarded" if:

- [ ] At least 6 scenarios created
- [ ] AI resolution rate ≥ 85%
- [ ] Escalation rate ≤ 15%
- [ ] Zero null response errors
- [ ] Customer has logged in to dashboard
- [ ] Customer has received 7-day report

If not met → extend onboarding another week with additional support.

---

## 📞 Common Issues & Fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| "AI keeps asking me to repeat myself" | Triggers too generic or ASR failing | Add more specific trigger phrases, test with different accents |
| "AI gives wrong answer to simple question" | Full reply text is wrong | Edit full reply in admin, make it clearer |
| "AI doesn't respond at all" | Scenario config error (no fullReplies, wrong type) | Validate scenario has fullReplies + proper type |
| "Too many escalations" | Scenarios missing triggers | Add more synonyms and variations |
| "Response is too slow" | Normal (platform is processing). Network lag. | Confirm Redis is responding, check metrics |

---

## 🚀 After Onboarding

- Customer has a working AI receptionist
- You have 1-2 weeks of call data (traces + metrics)
- Customer is checking dashboard regularly
- You're gathering intel on which scenarios need improvement (for all tenants)

---

## 📝 Onboarding Checklist Template

Copy and fill this for each new customer:

```
ONBOARDING CHECKLIST

Customer: _______________
Start Date: _______________
Target Live Date: _______________

PHASE 1: Discovery
[ ] Discovery call completed
[ ] Scenario map created (CSV)
[ ] 6 core scenarios identified

PHASE 2: Template Build
[ ] Starter templates shared
[ ] Admin setup walkthrough done
[ ] Scenarios created in system
[ ] Triggers added (5-10 each)
[ ] Full replies written

PHASE 3: Dry Run
[ ] 5/5 test calls passed
[ ] Call traces reviewed
[ ] Issues fixed

PHASE 4: Go Live
[ ] AI enabled at 100%
[ ] Dashboard link sent
[ ] Customer trained on monitoring

PHASE 5: 7-Day Review
[ ] Review meeting completed
[ ] Metrics reviewed
[ ] Improvement plan agreed
[ ] Next steps scheduled

STATUS: _______________
NOTES: _______________
```

---

**Status:** Ready to print or send as Notion doc to new customers.

