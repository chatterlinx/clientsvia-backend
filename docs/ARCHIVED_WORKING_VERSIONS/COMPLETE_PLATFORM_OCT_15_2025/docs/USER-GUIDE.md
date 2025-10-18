# 📖 USER GUIDE - AI Agent Settings

**Welcome to the AI Agent Settings!** This guide will help you configure your AI receptionist to perfection.

---

## 🎯 **GETTING STARTED**

### **Where to Find It:**
1. Log in to your Company Profile
2. Click the **"AI Agent Settings"** tab
3. You'll see 4 sub-tabs: **Variables, Filler Words, Scenarios, Analytics**

---

## 📊 **READINESS SCORE**

At the top of the page, you'll see your **Configuration Readiness Score**.

### **Score Breakdown:**
- **0-29%** 🔴 **Red** - Not ready (critical issues)
- **30-79%** 🟡 **Yellow** - Almost ready (minor issues)
- **80-100%** 🟢 **Green** - Ready to go live!

### **What It Checks:**
1. **Variables** (25 points) - Are all required fields filled?
2. **Filler Words** (15 points) - Do you have filler words configured?
3. **Urgency Keywords** (10 points) - Are emergency keywords set?
4. **Scenarios** (20 points) - Do you have conversation scenarios?
5. **Template Cloned** (15 points) - Have you cloned from Global AI Brain?
6. **AI Agent Ready** (15 points) - Is your AI agent activated?

### **Fix Now Buttons:**
If you see blockers, click the **"Fix Now"** button next to each issue. It will take you directly to the field that needs attention!

---

## 💼 **VARIABLES TAB**

Variables are placeholders like `{companyName}` or `{servicecallprice}` that get replaced in your AI's responses.

### **How to Edit:**
1. Click on any variable field
2. Type your value (e.g., "Joe's Plumbing" or "$125")
3. Click **"Save Changes"**

### **Preview Before Apply:**
When you click "Save Changes":
1. A **Preview Modal** appears
2. Shows **Before/After** comparison
3. Lists **affected scenarios**
4. You have **15 minutes** to review
5. Click **"Apply Changes"** to confirm

### **Validation:**
The system automatically validates:
- ✅ **Email** - Must be valid format (contact@company.com)
- ✅ **Phone** - Must be valid format (+1-239-555-0100)
- ✅ **Currency** - Accepts $125.99 or 125.99
- ✅ **URL** - Must start with https://
- ✅ **Required** - Fields marked with * cannot be empty

**If you see a red error message, fix it before saving!**

---

## 🗣️ **FILLER WORDS TAB**

Filler words are conversational "noise" like "um", "uh", "like" that get stripped from caller phrases.

### **Inherited vs Custom:**
- **Inherited** (blue badge) - From Global AI Brain template (read-only)
- **Custom** (green badge) - Your additions (editable)

### **How to Add:**
1. Click **"Add Filler Words"** button
2. Type words (one per line or comma-separated)
3. Click **"Add Words"**

**Examples:**
```
um, uh, like
you know
y'all
reckon
gonna
```

### **How to Remove:**
- Hover over a custom word
- Click the **"×"** button

### **Reset to Defaults:**
- Click **"Reset to Template"** to remove all custom words

---

## 🚨 **URGENCY KEYWORDS TAB** (Coming Soon)

Urgency keywords like "emergency", "flooding", "urgent" boost priority for emergency scenarios.

This will be configurable per company in a future update!

---

## 📋 **SCENARIOS TAB**

Scenarios are conversation templates cloned from the Global AI Brain.

### **What You See:**
- **Scenario Name** - e.g., "Book Appointment"
- **Category** - e.g., "Booking"
- **Triggers** - Phrases that activate this scenario
- **Status** - Live, Draft, or Archived

### **How to Search:**
- Use the **search bar** to find scenarios by name or trigger
- Filter by **category** using the dropdown

### **Editing Scenarios:**
Currently, scenarios are cloned from the Global AI Brain. To customize:
1. Admin must update the Global AI Brain template
2. You can request custom scenarios via support

---

## 📈 **ANALYTICS TAB** (Coming Soon)

Track how your AI agent is performing:
- Call volume
- Match rate
- Confidence scores
- Most used scenarios

---

## 🚀 **GO LIVE**

Once your **Readiness Score is 80% or higher**, the **"Go Live"** button will light up!

### **Steps to Go Live:**
1. Review all configuration
2. Click **"🚀 Go Live Now"** button
3. Confirm in the popup
4. Your AI agent is now active! 🎉

### **What Happens:**
- AI starts answering calls automatically
- Uses your variables in responses
- Strips filler words from caller phrases
- Detects urgency keywords
- Routes calls intelligently

### **After Going Live:**
- Button changes to **"🟢 Live"** (disabled)
- Status banner shows **"Live!"**
- You can still edit configuration (changes apply immediately)

---

## 🔧 **TROUBLESHOOTING**

### **"I can't save changes"**
- ✅ Check for **red validation errors**
- ✅ Make sure all **required fields** (*) are filled
- ✅ Try refreshing the page

### **"Preview token expired"**
- ✅ You have **15 minutes** to apply changes after previewing
- ✅ Click **"Save Changes"** again to generate a new preview

### **"Cannot go live" button is disabled**
- ✅ Check your **Readiness Score** (must be 80%+)
- ✅ Click **"Fix Now"** on any blockers
- ✅ Refresh the page after fixing issues

### **"Changes not reflected in AI calls"**
- ✅ Clear your browser cache
- ✅ Wait 30 seconds (cache refresh)
- ✅ Test by calling your Twilio number

---

## 💡 **BEST PRACTICES**

### **Variables:**
- ✅ Use **consistent formatting** (e.g., always include $ for prices)
- ✅ Keep **company name** short and clear
- ✅ Update **contact info** regularly
- ✅ Use **E.164 format** for phone numbers (+1-239-555-0100)

### **Filler Words:**
- ✅ Add **regional slang** (e.g., "y'all" for Southern US)
- ✅ Add **industry jargon** (e.g., "HVAC" for heating/cooling)
- ✅ Keep the list **under 20 words** (too many can hurt accuracy)
- ✅ Test by calling and saying phrases with filler words

### **Testing:**
- ✅ **Preview** every change before applying
- ✅ Call your test number after updates
- ✅ Monitor **Analytics** for performance
- ✅ Adjust based on real-world usage

---

## 📞 **SUPPORT**

### **Need Help?**
- 📧 **Email:** support@clientsvia.ai
- 📱 **Phone:** +1-239-555-HELP
- 💬 **Live Chat:** Available in dashboard

### **Resources:**
- **API Documentation:** See `API-DOCUMENTATION.md`
- **Architecture Guide:** See `MULTI-TENANT-ARCHITECTURE.md`
- **Video Tutorials:** Coming soon!

---

## 🎓 **GLOSSARY**

- **Variable:** A placeholder like `{companyName}` that gets replaced with your value
- **Filler Word:** Conversational noise stripped from caller phrases (e.g., "um", "like")
- **Urgency Keyword:** Words that boost priority for emergency scenarios (e.g., "emergency", "flooding")
- **Scenario:** A conversation template with triggers and responses
- **Readiness Score:** A 0-100 score measuring how ready your AI is to go live
- **Preview Token:** A secure, temporary token for reviewing changes before applying
- **Idempotency Key:** Prevents accidentally applying the same change twice
- **Multi-Tenant:** System architecture ensuring Company A never sees Company B's data

---

## 🎉 **YOU'RE ALL SET!**

Your AI receptionist is now configured and ready to handle calls 24/7.

**Remember:**
- ✅ Keep your variables up-to-date
- ✅ Monitor analytics regularly
- ✅ Test after making changes
- ✅ Reach out to support if you need help

**Happy AI-ing!** 🤖📞

