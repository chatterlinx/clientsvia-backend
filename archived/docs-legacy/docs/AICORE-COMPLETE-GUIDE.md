# 🤖 AICORE CONTROL CENTER - COMPLETE SETUP GUIDE
**Mission Control for Your AI Agent**

---

## 📚 TABLE OF CONTENTS

1. [Quick Start](#quick-start)
2. [Understanding the 4 Cores](#understanding-the-4-cores)
3. [VoiceCore Setup](#voicecore-setup)
4. [KnowledgeCore Setup](#knowledgecore-setup)
5. [MemoryCore Setup](#memorycore-setup)
6. [LogicCore Setup](#logiccore-setup)
7. [Testing Guide](#testing-guide)
8. [Troubleshooting](#troubleshooting)

---

## 🚀 QUICK START

### **What is AiCore Control Center?**
The unified hub for managing every aspect of your AI Agent:
- 🎙️ **VoiceCore**: Phone integration and greetings
- 🧠 **KnowledgeCore**: AI intelligence and scenarios
- 💾 **MemoryCore**: Variables and personalization
- ⚙️ **LogicCore**: Processing rules and behavior

### **5-Minute Setup**
```
1. Configure Twilio (VoiceCore)       → 2 min
2. Clone AI Template (KnowledgeCore)  → 1 min  ⚠️ CRITICAL!
3. Set Variables (MemoryCore)         → 1 min
4. Configure Filler Words (LogicCore) → 1 min
5. Test Call                          → Test!
```

---

## 🎯 UNDERSTANDING THE 4 CORES

### **The Call Flow**
```
Incoming Call
    ↓
🎙️ VoiceCore: Plays greeting
    ↓
Caller speaks
    ↓
⚙️ LogicCore: Removes filler words
    ↓
🧠 KnowledgeCore: Finds answer in 500+ scenarios
    ↓
💾 MemoryCore: Personalizes with variables
    ↓
🎙️ VoiceCore: Speaks response
```

### **How They Work Together**
Each Core is independent but communicates with others:
- **VoiceCore** handles all phone I/O
- **KnowledgeCore** provides intelligence (THE BRAIN!)
- **MemoryCore** personalizes responses
- **LogicCore** processes and optimizes

---

## 🎙️ VOICECORE SETUP

### **Location**
AI Agent Settings → Top Panel (Dashboard, Messages & Greetings, Call Logs)

---

### **STEP 1: Configure Twilio Credentials**

**Go to**: Dashboard tab

1. **Account SID**
   ```
   Format: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   Find: Twilio Console → Account Info
   ```

2. **Auth Token**
   ```
   Format: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   Find: Twilio Console → Account Info → Auth Token
   ```

3. **Phone Number**
   ```
   Format: +1XXXXXXXXXX
   Find: Twilio Console → Phone Numbers → Active Numbers
   ```

4. **Click Save**

**Expected Result**: ✅ Green checkmark "Twilio Connected"

---

### **STEP 2: Configure Webhook URLs**

**Go to**: Dashboard tab → Click "Show Webhook URLs"

1. **Copy Voice URL**
   ```
   https://yourdomain.com/api/twilio/voice/:companyId
   ```

2. **Paste in Twilio Console**
   - Go to: Phone Numbers → Active Numbers → Your Number
   - Section: Voice & Fax
   - "A CALL COMES IN" → Webhook → Paste URL
   - Method: HTTP POST
   - Save

**Expected Result**: ✅ Calls route to your AI Agent

---

### **STEP 3: Configure Greeting**

**Go to**: Messages & Greetings tab

**Choose 1 of 4 modes:**

#### **Option A: Real-Time TTS** (Recommended for testing)
1. Select: "Real-time TTS"
2. Enter text: "Thank you for calling {companyName}! How can we help you today?"
3. Click Save

**Pros**: Easy to change, uses variables  
**Cons**: Requires internet, slight delay

---

#### **Option B: Pre-recorded Audio**
1. Select: "Pre-recorded Audio"
2. Click: "Upload Audio File"
3. Choose: .mp3 or .wav file (professional recording)
4. Click Save

**Pros**: Professional quality, fastest  
**Cons**: Hard to change, no variables

---

#### **Option C: Skip Greeting**
1. Select: "Disabled (Go straight to AI)"
2. Click Save

**Pros**: Fastest, no greeting delay  
**Cons**: Less professional, caller might not know what to say

---

#### **Option D: Fallback Only**
Used automatically if Options A/B fail.

1. Go to: Fallback Settings
2. Enable: "Fallback System"
3. Enter: Emergency greeting text
4. Add: Admin phone/email for alerts
5. Click Save

**When Used**: Audio file missing, TTS fails, system error

---

### **STEP 4: Test VoiceCore**

**Go to**: Dashboard tab → System Diagnostics

**Check for:**
```
✅ Status: CONFIGURED
✅ connectionMessages: OK
✅ connectionMessages.voice: OK
✅ connectionMessages.voice.mode: OK (value: "realtime" or "prerecorded")
✅ Twilio credentials: OK
```

**If you see**:
```
❌ Status: NOT_CONFIGURED
❌ connectionMessages: MISSING
```

**Fix**: Go back to Messages & Greetings → Select mode → Save

---

## 🧠 KNOWLEDGECORE SETUP

### **⚠️ CRITICAL: This is THE BLOCKER!**

Without a template = No AI brain = Can't answer questions!

### **Location**
AI Agent Settings → Bottom Panel → Template Info tab

---

### **STEP 1: Clone a Template**

**Current Status**: ❌ NO_TEMPLATE

1. **Click**: "Clone Template" button
2. **Select Template**: Choose trade-specific template
   - Plumbing Services
   - HVAC Services
   - Electrical Services
   - General Contractor
   - (Or create custom)

3. **Click**: "Clone Now"

**What Happens**:
- ✅ 500+ Q&A scenarios copied to your company
- ✅ Variables definitions copied
- ✅ Filler words inherited
- ✅ AI brain activated!

**Expected Result**:
```
✅ Template Cloned: "Plumbing Services v1.2.0"
✅ Scenarios: 537 loaded
✅ Last Synced: Just now
✅ Status: Up to date
```

---

### **STEP 2: Browse Scenarios**

**Go to**: Scenarios tab

**You'll see**:
- 📋 Categories (Accordion style)
  - Scheduling & Appointments (87 scenarios)
  - Service Requests (124 scenarios)
  - Pricing & Quotes (56 scenarios)
  - Business Hours (23 scenarios)
  - Emergency Services (45 scenarios)
  - (And many more...)

**Features**:
- 🔍 Search scenarios
- 🏷️ Filter by category
- 📊 View match confidence
- ✅ See active status

**Test It**:
1. Search: "hours"
2. Find: "Business Hours" scenario
3. View: Question patterns and response
4. Note: Can't edit here (read-only)

---

### **STEP 3: Monitor Template Status**

**Go to**: Template Info tab

**Dashboard Shows**:
```
Template Version: 1.2.0
Your Version: 1.2.0
Status: ✅ Up to date

Cloned From: Global AI Brain - Plumbing Services
Cloned At: October 18, 2025
Last Synced: 2 minutes ago

Total Scenarios: 537
Active Scenarios: 537
Customized: 0
```

**If "Updates Available"**:
1. Review changes in Global AI Brain
2. Click "Sync Updates"
3. Confirm sync
4. ✅ Your template updated!

---

### **STEP 4: Test KnowledgeCore**

**Make a test call**:
1. Call your Twilio number
2. After greeting, say: "What are your hours?"
3. AI should respond with hours from scenario

**If AI says**:
- ✅ "We're open Monday-Friday 8am-5pm" → KnowledgeCore working!
- ❌ "I don't understand" → Template not cloned or synced

---

## 💾 MEMORYCORE SETUP

### **Location**
AI Agent Settings → Bottom Panel → Variables tab

---

### **STEP 1: Define Required Variables**

**Company Info** (Required):
```
companyName: "Royal Plumbing"
businessPhone: "(555) 123-4567"
businessEmail: "info@royalplumbing.com"
```

**Service Details** (Recommended):
```
businessHours: "Monday-Friday 8am-5pm, Saturday 9am-2pm"
serviceArea: "Greater Atlanta Area"
emergencyAvailable: "Yes, 24/7"
```

**Pricing** (Optional):
```
serviceCallFee: "$89"
emergencyFee: "$150"
discounts: "10% off for seniors and military"
```

---

### **STEP 2: How Variables Work**

**In Scenarios**:
```
Scenario text: "Thank you for calling {companyName}! We serve {serviceArea}."
```

**AI Response**:
```
"Thank you for calling Royal Plumbing! We serve Greater Atlanta Area."
```

**Validation**:
- ✅ Required fields must be filled
- ✅ Email format validated
- ✅ Phone format validated
- ✅ URL format validated

---

### **STEP 3: Track Variable Usage**

**Click**: "Show Usage" next to any variable

**See**:
```
Variable: {companyName}
Used in 47 scenarios:
  - Welcome Greeting
  - Business Hours Response
  - Service Area Response
  - Pricing Quote
  (and 43 more...)
```

**Why This Matters**:
Changing one variable updates ALL scenarios using it!

---

### **STEP 4: Test MemoryCore**

**Make a test call**:
1. Say: "What's your company name?"
2. AI should respond: "We're Royal Plumbing" (your actual company name)
3. Say: "What area do you serve?"
4. AI should respond with your service area

**If variables don't replace**:
- ❌ Check: Variables tab → Are they saved?
- ❌ Check: Refresh page → Load again
- ❌ Check: System Diagnostics → Any errors?

---

## ⚙️ LOGICCORE SETUP

### **Location**
AI Agent Settings → Bottom Panel → Filler Words & Analytics tabs

---

### **STEP 1: Review Filler Words**

**Go to**: Filler Words tab

**Inherited from Template** (Read-only):
```
✅ um, uh, like, you know, basically, actually, literally,
   kind of, sort of, I mean, well, so, just, really...
```

**Why They Matter**:
```
Caller says: "Um, like, what are your hours, you know?"
    ↓
LogicCore removes: ["um", "like", "you know"]
    ↓
Cleaned: "What are your hours?"
    ↓
Better scenario match found!
```

---

### **STEP 2: Add Custom Filler Words**

**If your industry has unique filler words**:

**Examples**:
- Plumbing: "basically", "you guys"
- HVAC: "like I said", "as far as"
- Legal: "pursuant to", "heretofore"

**To Add**:
1. Click: "+ Add Filler Words"
2. Enter: One per line or comma-separated
3. Click: "Add"

**Result**:
```
Custom Filler Words (4):
  - basically
  - you guys  
  - like I said
  - as far as

Total Active: 47 (43 inherited + 4 custom)
```

---

### **STEP 3: Monitor Analytics**

**Go to**: Analytics tab

**Metrics** (Coming Soon):
```
Match Rate: 94.3%
Avg Confidence: 87.2%
Avg Response Time: 18ms
Total Calls Today: 23
```

**What to Watch**:
- 📉 Low Match Rate → Add more scenarios
- 📉 Low Confidence → Add more filler words
- 📈 Slow Response → Contact support

---

### **STEP 4: Test LogicCore**

**Make a test call with filler words**:
1. Say: "Um, like, basically, what are your hours?"
2. AI should understand and respond correctly
3. Filler words removed automatically

**Test without filler words**:
1. Say: "What are your hours?"
2. Compare response quality

**Expected**: Both should get same correct answer!

---

## 🧪 TESTING GUIDE

### **Complete System Test**

#### **Test 1: VoiceCore**
```
✅ Call Twilio number
✅ Greeting plays correctly
✅ No errors or silence
✅ Greeting uses variables (if TTS mode)
```

#### **Test 2: KnowledgeCore**
```
✅ Say: "What are your hours?"
✅ AI responds with correct hours
✅ Say: "Do you offer emergency service?"
✅ AI responds with emergency info
```

#### **Test 3: MemoryCore**
```
✅ Say: "What's your phone number?"
✅ AI responds with your phone number
✅ Say: "Where are you located?"
✅ AI responds with your service area
```

#### **Test 4: LogicCore**
```
✅ Say: "Um, like, what's your name?"
✅ AI responds correctly (filler words removed)
✅ Say: "What's your name?" (no filler words)
✅ Compare quality (should be same)
```

---

### **Advanced Testing**

#### **Edge Cases**
```
- Speak unclearly → AI asks for clarification
- Ask off-topic → AI redirects politely
- Request transfer → AI follows transfer protocol
- Emergency keyword → AI escalates properly
```

#### **Load Testing**
```
- Multiple simultaneous calls
- Long conversations (10+ exchanges)
- Complex multi-part questions
- Variable-heavy responses
```

---

## 🐛 TROUBLESHOOTING

### **Issue: "NO_TEMPLATE" Error**

**Symptom**:
```
⚠️ Issues to Fix (1)
NO_TEMPLATE
No Global AI Brain template cloned
```

**Why**: AI needs scenarios to answer questions  
**Fix**: 
1. Go to: AI Agent Settings → Template Info tab
2. Click: "Clone Template"
3. Select template → Click "Clone Now"
4. Wait for: "Template cloned successfully!"

**Verify**:
```
✅ Scenarios tab shows 500+ scenarios
✅ Template Info shows cloned version
✅ Test call: AI answers questions
```

---

### **Issue: Greeting Not Playing**

**Symptom**: Call connects but silent or error message

**Possible Causes**:
1. **No greeting configured**
   - Fix: Messages & Greetings → Select mode → Save

2. **TTS text empty**
   - Fix: Messages & Greetings → Enter text → Save

3. **Audio file missing**
   - Fix: Messages & Greetings → Upload audio → Save

4. **Twilio webhook wrong**
   - Fix: Check webhook URL in Twilio Console

**Verify**: System Diagnostics should show all ✅ green

---

### **Issue: AI Gives Wrong Answers**

**Symptom**: AI responds but answer is incorrect or generic

**Possible Causes**:
1. **Template not synced**
   - Fix: Template Info → Click "Sync Updates"

2. **Variables not set**
   - Fix: Variables tab → Fill required fields

3. **Too many filler words in question**
   - Fix: Filler Words tab → Add more custom words

4. **Scenario doesn't exist**
   - Fix: Browse Scenarios → Check if pattern exists
   - Solution: Contact admin to add scenario to Global AI Brain

---

### **Issue: Variables Not Replacing**

**Symptom**: Response says "{companyName}" literally

**Possible Causes**:
1. **Variable not defined**
   - Fix: Variables tab → Add variable → Save

2. **Variable name mismatch**
   - Check: Scenario uses {companyName} but variable is {businessName}
   - Fix: Rename variable to match

3. **Cache issue**
   - Fix: Refresh browser → Load company again

**Verify**: Make test call → Variables should appear correctly

---

### **Issue: System Diagnostics Shows Errors**

**Read the diagnostics carefully**:

```
❌ connectionMessages: MISSING
Hint: Configure in AI Agent Settings > Messages & Greetings tab
```

**Each error includes**:
- ❌ What's wrong
- 💡 Where to fix it
- 🔧 How to fix it

**Follow the hints!**

---

## 📊 PRODUCTION CHECKLIST

### **Before Going Live**

#### **VoiceCore** ✅
- [ ] Twilio credentials configured and tested
- [ ] Phone number added
- [ ] Webhook URL set in Twilio Console
- [ ] Greeting configured (any mode)
- [ ] Fallback system enabled
- [ ] Test call successful

#### **KnowledgeCore** ⚠️ CRITICAL
- [ ] Template cloned from Global AI Brain
- [ ] 500+ scenarios loaded
- [ ] Scenarios browsed and verified
- [ ] Template version noted
- [ ] Sync status: Up to date

#### **MemoryCore** ✅
- [ ] All required variables defined
- [ ] Company info complete
- [ ] Service details filled
- [ ] Variable validation passed
- [ ] Test call: Variables replace correctly

#### **LogicCore** ✅
- [ ] Filler words reviewed
- [ ] Custom filler words added (if needed)
- [ ] Test call: Filler words removed
- [ ] Analytics: Baseline metrics recorded

---

### **Go-Live Day**

1. **Final System Check**
   ```
   - Run System Diagnostics
   - All checks should be ✅ green
   - No blockers or errors
   ```

2. **Test Calls** (Recommended: 5-10 calls)
   ```
   - Various question types
   - Edge cases
   - Transfer requests
   - Emergency scenarios
   ```

3. **Monitor First Hour**
   ```
   - Watch call logs
   - Listen to recordings
   - Check error rates
   - Verify quality
   ```

4. **Support Standby**
   ```
   - Have admin available
   - Quick response to issues
   - Can adjust configuration live
   ```

---

## 🎯 BEST PRACTICES

### **VoiceCore**
✅ Use Real-time TTS for flexibility  
✅ Keep greeting under 10 seconds  
✅ Use variables for personalization  
✅ Always enable fallback system  

### **KnowledgeCore**
✅ Sync template weekly  
✅ Review new scenarios  
✅ Browse scenarios by category  
✅ Note commonly asked questions  

### **MemoryCore**
✅ Keep variables up to date  
✅ Use descriptive variable names  
✅ Test variable replacement regularly  
✅ Track which scenarios use variables  

### **LogicCore**
✅ Review filler words monthly  
✅ Add industry-specific words  
✅ Monitor analytics trends  
✅ Optimize based on match rates  

---

## 📞 SUPPORT

### **Need Help?**

1. **Check System Diagnostics First**
   - Most issues show clear error messages
   - Follow hints to fix

2. **Review This Guide**
   - Search for your issue
   - Follow troubleshooting steps

3. **Check Architecture Doc**
   - `AICORE-CONTROL-CENTER-ARCHITECTURE.md`
   - Technical details and schema

4. **Contact Support**
   - Provide: Company ID
   - Include: System diagnostics output
   - Describe: What you tried

---

## 🎉 SUCCESS!

### **You're Ready When**:

```
✅ All 4 Cores configured
✅ Template cloned (KnowledgeCore)
✅ Test calls successful
✅ System diagnostics all green
✅ No errors or blockers
```

### **Your AI Agent Now**:
- 🎙️ Answers calls professionally
- 🧠 Responds with 500+ scenarios
- 💾 Personalizes with your info
- ⚙️ Processes intelligently

---

**Welcome to AiCore Control Center!**  
**Your AI Agent is now live and ready to impress!** 🚀

---

**Guide Version**: 2.0.0  
**Last Updated**: October 18, 2025  
**Next**: Test your first call!

