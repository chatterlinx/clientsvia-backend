# 🧪 **VARIABLES IN CHEAT SHEET - COMPLETE TESTING GUIDE**

## 📊 **What Was Built:**

### **Complete {variable} support across ALL cheat sheet components:**
- ✅ **Frontline-Intel** - Company instructions and protocols
- ✅ **Edge Cases** - Spam detection and unusual input handling
- ✅ **Transfer Rules** - Department routing scripts and phone numbers
- ✅ **Runtime Replacement** - All {variables} replaced automatically
- ✅ **Scanner Integration** - Detects variables in all locations

---

## 🚀 **Test Plan - Step by Step**

### **Step 1: Run Setup Scripts** ⚙️

```bash
# 1. Add default HVAC variables to all companies
node scripts/add-default-hvac-variables.js

# 2. Seed cheat sheet defaults with {variables} (optional)
node scripts/seed-cheatsheet-defaults.js
```

**Expected Output:**
```
✅ Connected to MongoDB
📊 Found 21 companies
🏢 Processing: Royal HVAC
   ✅ Added 10 new variables:
      • {companyName} - Company Name
      • {emergencyPhone} - Emergency Phone Number
      • {mainPhone} - Main Office Phone
      • {billingPhone} - Billing Department Phone
      • {schedulingPhone} - Scheduling Phone Number
      • {serviceAreas} - Service Areas / Cities
      • {serviceAdvisorName} - Service Advisor Name
      • {managerName} - Manager / Owner Name
      • {businessHours} - Business Hours
      • {officeAddress} - Office Address
   📊 Total variables now: 10
```

---

### **Step 2: Check Frontline-Intel for {variables}** 📝

**UI Path:**
```
AI Agent Settings → Cheat Sheet → Frontline-Intel
```

**What to Look For:**
```
"Thank you for calling {companyName}"
"Our emergency line is {emergencyPhone}"
"We service {serviceAreas}"
"Transfer to {serviceAdvisorName}"
"Our business hours: {businessHours}"
"Office address: {officeAddress}"
```

**Click "Open Full Editor"** to see all variables in large view!

---

### **Step 3: Check Edge Cases for {variables}** 🚨

**UI Path:**
```
AI Agent Settings → Cheat Sheet → Edge Cases section
```

**Example Edge Case:**
```
Name: AI Telemarketer - Generic Script
Response: "{companyName} does not accept unsolicited sales calls. 
          Please remove us from your list. Goodbye."
```

**Example Edge Case with Address:**
```
Name: Call Center Background Noise
Response: "{companyName} doesn't accept telemarketing calls. 
          If you need HVAC service, please visit our office at {officeAddress}. 
          Goodbye."
```

---

### **Step 4: Check Transfer Rules for {variables}** 📞

**UI Path:**
```
AI Agent Settings → Cheat Sheet → Transfer Rules section
```

**Example Transfer Rule:**
```
Name: Emergency Service Transfer
Phone Number: {emergencyPhone}
Script: "This sounds urgent. Let me connect you to our emergency 
        service line at {emergencyPhone} right now."
```

**Example Transfer Rule:**
```
Name: Billing Department Transfer
Phone Number: {billingPhone}
Script: "Let me transfer you to our billing department at {billingPhone}. 
        They'll take great care of you."
```

**Example Transfer Rule:**
```
Name: General Scheduling Transfer
Phone Number: {schedulingPhone}
Script: "Perfect! Let me connect you with {companyName} scheduling team 
        at {schedulingPhone} to book your appointment."
```

---

### **Step 5: Run Variable Scanner** 🔍

**UI Path:**
```
AI Agent Settings → Variables Tab → "Force Scan All Variables" button
```

**Expected Scanner Output (in console/logs):**
```
🔍 [ENTERPRISE SCAN] Checkpoint 6.5: Scanning Frontline-Intel...
📝 [ENTERPRISE SCAN] Frontline-Intel text: 5234 characters
✅ [ENTERPRISE SCAN] Found 15 variable occurrences in Frontline-Intel
  📌 [ENTERPRISE SCAN] Variable {companyName} found 3 time(s) in Frontline-Intel
  📌 [ENTERPRISE SCAN] Variable {emergencyPhone} found 2 time(s) in Frontline-Intel
  📌 [ENTERPRISE SCAN] Variable {serviceAreas} found 1 time(s) in Frontline-Intel
✅ [ENTERPRISE SCAN] Checkpoint 6.5.3: Frontline-Intel scan complete
📊 [ENTERPRISE SCAN] 10 unique variables, 523 words

🔍 [ENTERPRISE SCAN] Checkpoint 6.6: Scanning Edge Cases...
📝 [ENTERPRISE SCAN] Checkpoint 6.6.1: Scanning 5 edge cases
  📌 [ENTERPRISE SCAN] Variable {companyName} found 1 time(s) in edge case "AI Telemarketer - Generic Script"
  📌 [ENTERPRISE SCAN] Variable {companyName} found 1 time(s) in edge case "Call Center Background Noise"
  📌 [ENTERPRISE SCAN] Variable {officeAddress} found 1 time(s) in edge case "Call Center Background Noise"
✅ [ENTERPRISE SCAN] Checkpoint 6.6.2: Edge Cases scan complete
📊 [ENTERPRISE SCAN] 2 unique variables, 28 words

🔍 [ENTERPRISE SCAN] Checkpoint 6.7: Scanning Transfer Rules...
📝 [ENTERPRISE SCAN] Checkpoint 6.7.1: Scanning 3 transfer rules
  📌 [ENTERPRISE SCAN] Variable {emergencyPhone} found 1 time(s) in transfer rule "Emergency Service Transfer"
  📌 [ENTERPRISE SCAN] Variable {billingPhone} found 1 time(s) in transfer rule "Billing Department Transfer"
  📌 [ENTERPRISE SCAN] Variable {schedulingPhone} found 1 time(s) in transfer rule "General Scheduling Transfer"
  📌 [ENTERPRISE SCAN] Variable {companyName} found 1 time(s) in transfer rule "General Scheduling Transfer"
✅ [ENTERPRISE SCAN] Checkpoint 6.7.2: Transfer Rules scan complete
📊 [ENTERPRISE SCAN] 4 unique variables, 42 words
```

**What You Should See in UI:**
```
Variables Detected:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{companyName}         → Used 5 times
  ✓ Frontline-Intel (3)
  ✓ Edge Cases (1)
  ✓ Transfer Rules (1)

{emergencyPhone}      → Used 3 times
  ✓ Frontline-Intel (2)
  ✓ Transfer Rules (1)

{billingPhone}        → Used 2 times
  ✓ Frontline-Intel (1)
  ✓ Transfer Rules (1)

{schedulingPhone}     → Used 2 times
  ✓ Frontline-Intel (1)
  ✓ Transfer Rules (1)

{serviceAreas}        → Used 1 time
  ✓ Frontline-Intel (1)

{officeAddress}       → Used 1 time
  ✓ Edge Cases (1)
```

---

### **Step 6: Fill Variable Values** ✏️

**UI Path:**
```
AI Agent Settings → Variables Tab
```

**Example Values to Fill:**
```
{companyName}         → "Royal HVAC"
{emergencyPhone}      → "(555) 123-4567"
{mainPhone}           → "(555) 111-2222"
{billingPhone}        → "(555) 333-4444"
{schedulingPhone}     → "(555) 555-6666"
{serviceAreas}        → "Tampa, St. Pete, Clearwater"
{serviceAdvisorName}  → "Mike Johnson"
{managerName}         → "John Smith"
{businessHours}       → "Monday-Friday 8am-5pm"
{officeAddress}       → "123 Main St, Tampa, FL 33601"
```

**Click "Save Variables"**

---

### **Step 7: Test Runtime Replacement** 🎯

**Backend Logs to Watch:**
```bash
# Watch logs when AI agent processes a call
tail -f logs/app.log  # Or check Render logs
```

**Expected Logs:**

#### **Frontline-Intel:**
```
🔄 [FRONTLINE-INTEL] Replacing variables in Frontline-Intel text...
✅ [FRONTLINE-INTEL] Variables replaced: 5234 → 5280 chars
```

#### **Edge Case Triggered:**
```
[CHEAT SHEET ENGINE] Replacing variables in edge case response...
[PLACEHOLDERS] Processing 2 variables for company 68e3f77a...
[PLACEHOLDERS] Replaced {companyName} → "Royal HVAC"
[PLACEHOLDERS] Replaced {officeAddress} → "123 Main St, Tampa, FL 33601"
[CHEAT SHEET ENGINE] Edge case triggered (short-circuit)
```

#### **Transfer Rule Triggered:**
```
[CHEAT SHEET ENGINE] Replacing variables in transfer script...
[PLACEHOLDERS] Processing 2 variables for company 68e3f77a...
[PLACEHOLDERS] Replaced {emergencyPhone} → "(555) 123-4567"
[PLACEHOLDERS] Replaced {companyName} → "Royal HVAC"
[CHEAT SHEET ENGINE] Transfer rule applied
```

---

## 🎯 **Manual Test Scenarios**

### **Test 1: Frontline-Intel Variable Replacement**

**Simulate Call:**
```
Caller: "Hi, I need help with my AC"
```

**Expected AI Response:**
```
Before Variables:
"Thank you for calling {companyName}. I can help with that!"

After Variables:
"Thank you for calling Royal HVAC. I can help with that!"
```

---

### **Test 2: Edge Case Variable Replacement**

**Simulate Call:**
```
Caller: "Can you hear me? Hello? This is Sarah calling about..."
```

**Edge Case Triggered:** "AI Telemarketer - Generic Script"

**Expected AI Response:**
```
Before Variables:
"{companyName} does not accept unsolicited sales calls. Goodbye."

After Variables:
"Royal HVAC does not accept unsolicited sales calls. Goodbye."
```

---

### **Test 3: Transfer Rule Variable Replacement**

**Simulate Call:**
```
Caller: "My AC is completely broken and it's 95 degrees!"
```

**Transfer Rule Triggered:** "Emergency Service Transfer"

**Expected AI Response:**
```
Before Variables:
"This sounds urgent. Let me connect you to our emergency service line at {emergencyPhone} right now."

After Variables:
"This sounds urgent. Let me connect you to our emergency service line at (555) 123-4567 right now."
```

---

## 🧪 **Advanced Testing: Multiple Companies**

### **Test Variable Independence:**

**Company A:**
```
{companyName} = "Royal HVAC"
{emergencyPhone} = "(555) 123-4567"
```

**Company B:**
```
{companyName} = "Cool Air Pros"
{emergencyPhone} = "(555) 987-6543"
```

**Expected Behavior:**
- Company A's calls use "(555) 123-4567"
- Company B's calls use "(555) 987-6543"
- No cross-contamination between companies

---

## 📊 **Expected Results Summary**

### **Scanner Should Detect:**
| Location | Variables Found |
|----------|----------------|
| **Frontline-Intel** | {companyName}, {emergencyPhone}, {mainPhone}, {billingPhone}, {schedulingPhone}, {serviceAreas}, {serviceAdvisorName}, {managerName}, {businessHours}, {officeAddress} |
| **Edge Cases** | {companyName}, {officeAddress} |
| **Transfer Rules** | {companyName}, {emergencyPhone}, {billingPhone}, {schedulingPhone} |
| **Total Unique** | 10 variables |
| **Total Occurrences** | 15-20+ (depending on usage) |

### **Runtime Should Replace:**
- ✅ All {variables} in Frontline-Intel system prompts
- ✅ All {variables} in edge case responses
- ✅ All {variables} in transfer rule scripts
- ✅ All {variables} in transfer phone numbers

### **Benefits Demonstrated:**
- ✅ **One-time setup** - Fill variables once, use everywhere
- ✅ **Template reusability** - Same cheat sheet, different values
- ✅ **Centralized management** - Edit once, updates all locations
- ✅ **Zero hardcoding** - All company data is dynamic
- ✅ **Multi-tenant** - Each company has their own values

---

## 🚨 **Troubleshooting**

### **Variables Not Detected:**
```
1. Check if {variable} syntax is correct (not {{variable}})
2. Run scanner again: "Force Scan All Variables"
3. Check console logs for scanner checkpoints
4. Verify cheat sheet has data (Frontline-Intel, edge cases, transfer rules)
```

### **Variables Not Replaced at Runtime:**
```
1. Verify variables have values (not blank)
2. Check backend logs for "[PLACEHOLDERS]" messages
3. Ensure company document has aiAgentSettings.variables populated
4. Test with simpler variable like {companyName} first
```

### **Scanner Shows 0 Variables:**
```
1. Check if Frontline-Intel text is empty
2. Check if edge cases exist and have responseText
3. Check if transfer rules exist and have script/phoneNumber
4. Verify {variable} syntax (curly braces, no spaces)
```

---

## 🎉 **Success Criteria**

### **✅ Test is SUCCESSFUL if:**
1. Scanner detects variables in:
   - Frontline-Intel ✓
   - Edge Cases ✓
   - Transfer Rules ✓
2. Variables tab shows 10 default variables
3. Scanner shows usage count for each variable
4. Scanner shows locations (which component uses it)
5. Backend logs show variable replacement
6. AI responses contain actual values, not {placeholders}
7. Each company has independent variable values

---

## 📝 **Next Steps After Testing**

1. **If All Tests Pass:**
   - Deploy to production
   - Train team on variable management
   - Create company-specific variable templates
   - Document variable naming conventions

2. **If Tests Fail:**
   - Check logs (provide exact error messages)
   - Verify environment variables (MONGODB_URI, REDIS_URL)
   - Test with single company first
   - Share screenshots for debugging

---

## 💡 **Pro Tips**

1. **Use Descriptive Variable Names:**
   ```
   Good: {emergencyPhone}, {serviceAdvisorName}
   Bad: {phone1}, {name}
   ```

2. **Pre-fill Important Variables:**
   ```
   {companyName} → Auto-filled from company profile
   {mainPhone} → Copy from company contact info
   ```

3. **Test in Stages:**
   ```
   Stage 1: Scanner detects variables ✓
   Stage 2: Fill variables and save ✓
   Stage 3: Test runtime replacement ✓
   ```

4. **Monitor Logs:**
   ```
   Watch for:
   - "Replacing variables in Frontline-Intel text..."
   - "Replacing variables in edge case response..."
   - "Replacing variables in transfer script..."
   ```

---

## 🔥 **What Makes This Special**

### **Before (Manual Hell):**
```
1. Edit Frontline-Intel → Type "Royal HVAC" 15 times
2. Edit Edge Cases → Type "(555) 123-4567" manually
3. Edit Transfer Rules → Copy/paste phone numbers
4. Company changes name → Find/replace everywhere
5. Import template to new company → Re-enter ALL data
```

### **After (Automated Bliss):**
```
1. Run scanner → Detects {companyName}, {emergencyPhone}, etc.
2. Fill values ONCE in Variables tab
3. All locations update automatically
4. Company changes name → Edit ONCE
5. Import template to new company → Just fill 10 variables!
```

---

## 📞 **Need Help?**

If you encounter issues:
1. Share scanner output (console logs)
2. Share backend logs (look for "[PLACEHOLDERS]")
3. Share screenshots of Variables tab
4. Provide example {variable} that's not working

---

**Ready to test? Let's go! 🚀**

