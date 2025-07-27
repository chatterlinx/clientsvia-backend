# ClientsVia Platform - Developer Coding Manual

**Version:** 1.0  
**Last Updated:** July 27, 2025 - Console.log cleanup & Security validation session  
**Platform Status:** LIVE IN PRODUCTION  
**Production URL:** https://clientsvia-backend.onrender.com    

---

## 📚 **HOW TO UPDATE THIS MANUAL - INSTRUCTIONS FOR FUTURE AGENTS**

### **🎯 WHEN TO UPDATE:**
- **After every work session** - Add session logs with findings
- **When discovering new architecture patterns** - Document for future reference
- **After fixing production issues** - Record root cause and solution
- **When finding mistakes** - Add to "COMMON MISTAKES" section
- **After security validations** - Update security patterns section
- **When creating new workflows** - Document the process

### **🔧 HOW TO UPDATE:**

#### **1. Session Log Updates (MANDATORY after each session):**
```markdown
### Session Log - [DATE] ([TIME] PST)

**🎯 TASK:** [Brief description of what was worked on]
**📁 FILES MODIFIED:** [List key files changed]
**🔍 FINDINGS:** 
- [Key discovery 1]
- [Key discovery 2] 
**🚨 ISSUES FOUND:**
- [Any problems discovered]
**✅ SOLUTIONS APPLIED:**
- [How issues were resolved]
**📝 LESSONS LEARNED:**
- [Critical lessons for future reference]
**🔗 COMMITS:** [Git commit hashes for reference]
```

#### **2. Disaster/Mistake Documentation:**
When you make a mistake that breaks production or causes issues:
```markdown
**[DATE] - [BRIEF TITLE]:**
**MISTAKE:** [Exactly what was done wrong]
**RESULT:** [What broke/failed]
**CAUSE:** [Root cause analysis]
**EXAMPLE:** [Code example if applicable]
**LESSON:** [Key takeaway]
**RECOVERY:** [Exact commands/steps used to fix]
**COMMIT:** [Recovery commit hash]
```

#### **3. Architecture Pattern Updates:**
When you discover how something works in the codebase:
```markdown
### **🏗 [COMPONENT NAME] Architecture:**
**Purpose:** [What this component does]
**Key Files:** [Main files involved]
**Data Flow:** [How data moves through the system]
**Critical Functions:** [Important functions to know]
**Common Issues:** [Problems to watch for]
**Examples:** [Code examples]
```

#### **4. Security Pattern Updates:**
When validating security or finding security issues:
```markdown
### **🔒 [AREA] Security Validation:**
**Date:** [When validated]
**Scope:** [What was checked]
**Method:** [How validation was done]
**Findings:** [Security status]
**Issues:** [Any vulnerabilities found]
**Fixes:** [How issues were resolved]
**Pattern:** [Security pattern to follow]
```

### **🛠 MANUAL UPDATE COMMANDS:**

#### **After Each Work Session:**
```bash
# 1. Update the manual with session findings
code CLIENTSVIA_CODING_MANUAL.md

# 2. Update the production checklist
code production-ready-checklist.md

# 3. Commit both files together
git add CLIENTSVIA_CODING_MANUAL.md production-ready-checklist.md
git commit -m "DOCS: Session log [DATE] - [BRIEF_DESCRIPTION]

- [Key finding 1]
- [Key finding 2]
- [Any issues/lessons learned]"

# 4. Push to remote
git push origin main
```

### **📍 MANUAL STRUCTURE GUIDE:**

The manual should always maintain this structure:
1. **Header** - Version, last updated, status
2. **Update Instructions** (this section)
3. **Session Logs** - Most recent first
4. **Safe Production Practices** 
5. **Common Mistakes to Avoid**
6. **Quick Reference**
7. **Architecture Breakdowns**
8. **Security Patterns**
9. **Troubleshooting Guides**
10. **End-of-Session Workflow**

### **🚨 CRITICAL RULES:**

1. **NEVER delete old session logs** - They contain valuable historical context
2. **ALWAYS update after production incidents** - Document mistakes for learning
3. **BE SPECIFIC with examples** - Include code snippets and exact commands
4. **CROSS-REFERENCE files** - Link related sections and files
5. **UPDATE BOTH manual and checklist** - Keep them synchronized
6. **COMMIT DOCUMENTATION** - Don't lose the knowledge

### **📝 TEMPLATE FOR QUICK UPDATES:**

```markdown
### Session Log - [DATE]

**Task:** [What you worked on]
**Files:** [Files modified]
**Issue:** [Problem encountered]
**Solution:** [How you fixed it]  
**Lesson:** [Key takeaway]
**Commit:** [Git hash]
```

---

## 📝 **SESSION LOG - JULY 27, 2025**

### **🧹 Console.log Cleanup Findings:**
- **Logger Utility Added:** Production-aware logging system in `company-profile-modern.js`
- **Security Issue Fixed:** Removed `console.log('🔧 Full token for debug:', savedToken)` - CRITICAL
- **Performance:** Removed 61 verbose debug statements (270→209)
- **Patterns:** Most noise from tab initialization, phone setup, voice selection loops
- 🚨 **CRITICAL ERROR:** Used sed commands to remove console.log, broke JavaScript syntax, took production DOWN
- 🔥 **EMERGENCY FIX:** Had to revert files to working version, lost cleanup progress
- 📝 **NEW RULE:** Never use automated sed/regex for console.log removal on complex JavaScript

### **🔒 Security Validation Findings:**
- **Company Routes:** ✅ Proper ObjectId validation in `/api/company/:id`
- **ElevenLabs Routes:** ✅ Company.findById() ensures isolation in `/api/elevenlabs/*`
- **Pattern:** All critical routes use `Company.findById(companyId)` correctly

### **📋 Workflow Established:**
- **End-of-session updates** mandatory for manual and checklist
- **Knowledge retention** system prevents re-learning architecture

### Session Log - July 27, 2025 (17:00 PST)

**🎯 TASK:** Fix company profile data loading issue and create manual update instructions  
**📁 FILES MODIFIED:** 
- `public/company-profile.html` - Added critical DOMContentLoaded initialization script
- `CLIENTSVIA_CODING_MANUAL.md` - Added comprehensive update instructions and troubleshooting guide

**🔍 FINDINGS:**
- Company profile page was showing "Loading..." indefinitely 
- Root cause: No initialization script to bridge URL parameter to JavaScript functionality
- CompanyProfileManager class was defined but never instantiated or called

**🚨 ISSUES FOUND:**
- Missing DOMContentLoaded event listener in company-profile.html
- No bridge between URL company ID parameter and CompanyProfileManager.init()
- Previous troubleshooting knowledge not documented for future reference

**✅ SOLUTIONS APPLIED:**
- Added initialization script that extracts company ID from URL
- Script creates CompanyProfileManager instance and calls init()
- Added comprehensive troubleshooting guide with step-by-step diagnosis
- Created detailed manual update instructions for future agents

**📝 LESSONS LEARNED:**
- Always ensure there's an initialization bridge between URL parameters and JavaScript functionality
- Defining functions isn't enough - something must CALL them on page load
- Document troubleshooting procedures immediately after resolving issues
- Future agents need explicit instructions on how to maintain the knowledge base

**🔗 COMMITS:** 
- Company profile fix and manual update instructions
- Comprehensive troubleshooting guide for data loading issues

---

## 🚨 **SAFE PRODUCTION PRACTICES**

### **Console.log Cleanup - SAFE METHOD:**
```javascript
// 1. MANUAL INSPECTION: Always check context before removing
// 2. REPLACE, don't delete: 
//    console.log('debug') → // console.log('debug')
// 3. NEVER use sed/regex on complex JavaScript files
// 4. TEST locally before production push
// 5. Keep error logs: console.error() should remain
```

### **Emergency Recovery Commands:**
```bash
# Revert specific files to last working commit
git checkout COMMIT_HASH -- path/to/file.js

# Check production immediately after pushing changes
curl https://clientsvia-backend.onrender.com/company-profile.html?id=68813026dd95f599c74e49c7

# Monitor production logs in real-time
# Via Render dashboard → Logs → Live tail
```

### **Pre-Production Checklist:**
- [ ] Test locally: `npm start` works without errors
- [ ] Check browser console: No JavaScript errors
- [ ] Test main functionality: Company profile loads
- [ ] Verify API endpoints: Company data fetches correctly
- [ ] Have rollback plan: Know last working commit hash

---

## 🎯 **QUICK REFERENCE - CRITICAL INFO**

### **⚠️ COMMON MISTAKES TO AVOID:**
- ❌ **NOT** `company` - **IT'S** `companies` (MongoDB collection name)
- ❌ **NOT** `companyID` - **IT'S** `companyId` (consistent camelCase)
- ❌ **NOT** `Company.find()` without filters - **ALWAYS** use `Company.findById(companyId)`
- ❌ **NOT** direct API key access - **USE** the helper functions for company-specific keys
- 🚨 **CRITICAL:** **NEVER** use sed/regex to remove console.log statements - **BREAKS JAVASCRIPT SYNTAX**

### **🔥 PRODUCTION DISASTER - JULY 27, 2025:**
**MISTAKE:** Used `sed -i '' '/console\.log.*pattern/d'` commands to remove console.log statements
**RESULT:** Completely broke JavaScript syntax, production platform DOWN
**CAUSE:** sed removed console.log calls that were part of object literals, leaving orphaned syntax
**EXAMPLE OF BROKEN CODE:**
```javascript
// BEFORE (working):
console.log('Debug:', {
    twilioConfig: this.currentData.twilioConfig,
    authToken: 'hidden'
});

// AFTER sed removal (BROKEN):
    twilioConfig: this.currentData.twilioConfig,  // Orphaned object literal!
    authToken: 'hidden'
});  // Orphaned closing bracket!
```
**LESSON:** Manual console.log removal only, never automated sed/regex on complex JavaScript
**RECOVERY:** `git checkout 7b8105a2 -- public/js/company-profile-modern.js public/company-profile.html`

**SECOND DISASTER - JULY 27, 2025 (16:45 PST):**
**MISTAKE:** After restoring files, manually tried to fix sed-broken syntax but MORE orphaned objects found
**RESULT:** Even more JavaScript syntax errors, production still broken
**CAUSE:** The sed damage was extensive - orphaned object literals throughout multiple functions
**LESSON:** When sed breaks syntax, don't try to patch individual lines - FULL RESTORE needed
**RECOVERY:** `git checkout HEAD~2 -- public/js/company-profile-modern.js public/company-profile.html`
**COMMIT:** 80373538 - "SECOND HOTFIX: Restore files to working state before console cleanup"
**PROTOCOL:** When sed breaks code, immediately restore to last known good commit, don't attempt repairs

**THIRD ISSUE - JULY 27, 2025 (17:00 PST):**
**PROBLEM:** After file restoration, company profile page still showed "Loading..." and never loaded data
**ROOT CAUSE:** Missing initialization script - CompanyProfileManager class exists but was never instantiated
**SYMPTOMS:** Page loads, shows "Loading...", but stays stuck there indefinitely
**DIAGNOSIS:** No DOMContentLoaded script to extract company ID and create manager instance
**SOLUTION:** Added initialization script in company-profile.html:
```html
<script>
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    if (companyId) {
        window.companyId = companyId;
        window.companyProfileManager = new CompanyProfileManager();
        window.companyProfileManager.init();
    }
});
</script>
```
**COMMIT:** e18cd84d - "FIX: Add missing CompanyProfileManager initialization script"
**LESSON:** JavaScript files can define classes perfectly, but without initialization scripts, nothing happens

### **🔑 KEY API ENDPOINTS PATTERN:**
```javascript
// CORRECT: Company-specific endpoints
GET    /api/company/:companyId
PATCH  /api/company/:companyId  
GET    /api/company/:companyId/elevenlabs/voices
POST   /api/company/:companyId/elevenlabs/test-connection

// WRONG: Global endpoints without company isolation
GET    /api/companies  // Don't use for multi-tenant operations
```

---

## 🏗️ **SYSTEM ARCHITECTURE OVERVIEW**

### **Multi-Tenant Foundation:**
```
ClientsVia Platform (Single Codebase)
├── MongoDB Database
│   ├── companies collection (main tenant data)
│   ├── conversations collection (call logs)
│   ├── tradecategories collection (global categories)
│   └── users collection (admin access)
│
├── Company Isolation Pattern
│   └── Every operation MUST include companyId filter
│
└── Frontend: Company Profile Management
    └── URL Pattern: /company-profile.html?id={companyId}
```

---

## 📋 **COMPANY PROFILE TABS - CODING BREAKDOWN**

### **1. OVERVIEW TAB**
**Purpose:** Basic company information and contacts  
**Key Files:** 
- Frontend: `public/company-profile.html` (lines ~300-800)
- Backend: `routes/company.js` (GET/PATCH endpoints)
- Model: `models/Company.js`

**Data Structure:**
```javascript
// Company Schema Key Fields
{
  _id: ObjectId (companyId),
  companyName: String,
  companyPhone: String,
  companyAddress: String,
  status: String ('active'|'inactive'),
  timezone: String,
  contacts: [{
    name: String,
    email: String, 
    phone: String,
    role: String,
    isPrimary: Boolean
  }]
}
```

**API Endpoints:**
```javascript
GET /api/company/:companyId      // Fetch company data
PATCH /api/company/:companyId    // Update company data
```

**Common Issues:**
- ✅ Always use `ObjectId.isValid(companyId)` before queries
- ✅ Frontend form data collection via `new FormData()`
- ✅ Contact management uses array operations

---

### **2. CONFIGURATION TAB**
**Purpose:** Twilio phone settings and webhook configuration  
**Key Files:**
- Frontend: `public/js/company-profile-modern.js` (lines ~950-1400)
- Backend: `routes/company.js` (PATCH endpoint)

**Data Structure:**
```javascript
// Twilio Configuration Schema
twilioConfig: {
  // Legacy single phone (still supported)
  phoneNumber: String,
  
  // NEW: Array format (current standard)
  phoneNumbers: [{
    phoneNumber: String,     // "+12392322030"
    friendlyName: String,    // "Primary Number"
    status: String,          // "active"
    isPrimary: Boolean       // true for main number
  }],
  
  // Credentials
  accountSid: String,        // "AC18c622a49f28d9abf8952ecf06ba59f2"
  authToken: String,         // Encrypted/hashed
  apiKey: String,           // Optional API key
  apiSecret: String         // Optional API secret
}
```

**⚠️ CRITICAL PHONE NUMBER LOOKUP:**
```javascript
// Twilio webhook uses BOTH formats for company lookup
const company = await Company.findOne({
  $or: [
    { 'twilioConfig.phoneNumber': phoneNumber },      // Legacy
    { 'twilioConfig.phoneNumbers.phoneNumber': phoneNumber }  // New array
  ]
});
```

**Files to Check:**
- `routes/twilio.js` - Webhook endpoints
- `routes/company.js` - Configuration save/load

---

### **3. VOICE TAB (ElevenLabs Integration)**
**Purpose:** AI voice synthesis configuration  
**Key Files:**
- Frontend: `public/company-profile.html` (lines ~2400-2900)
- Backend: `routes/elevenLabs.js`
- Service: `services/elevenLabsService.js`

**Data Structure:**
```javascript
// AI Settings for Voice
aiSettings: {
  elevenLabs: {
    voiceId: String,          // "UgBBYS2sOqTuMpoF3BR0" 
    useOwnApiKey: Boolean,    // false = use global, true = company key
    apiKey: String,           // Company-specific API key (optional)
    
    // Voice parameters
    stability: Number,        // 0.0-1.0
    similarityBoost: Number,  // 0.0-1.0  
    style: Number            // 0.0-1.0
  }
}
```

**API Key Priority Logic:**
```javascript
// In services/elevenLabsService.js
function getApiKey(company) {
  if (company.aiSettings?.elevenLabs?.useOwnApiKey && 
      company.aiSettings?.elevenLabs?.apiKey) {
    return company.aiSettings.elevenLabs.apiKey;  // Company key
  }
  return process.env.ELEVENLABS_API_KEY;  // Global platform key
}
```

**Key Endpoints:**
```javascript
GET  /api/company/:companyId/elevenlabs/voices        // Fetch available voices
POST /api/company/:companyId/elevenlabs/test-connection // Test API key
POST /api/company/:companyId/elevenlabs/synthesize    // Generate TTS
POST /api/company/:companyId/elevenlabs/stream        // Stream audio
```

**Common Voice Issues:**
- ✅ Voice selector shows "undefined" → Check `voice.voice_id` vs `voice.id`
- ✅ API connection fails → Check company vs global API key logic
- ✅ Voice not saving → Verify `collectVoiceData()` function in frontend

---

### **4. AI SETTINGS TAB**
**Purpose:** AI agent behavior and intelligence configuration  
**Key Files:**
- Frontend: `public/js/company-profile-modern.js` (lines ~2500-2600)
- Backend: `routes/company.js`

**Data Structure:**
```javascript
// AI Intelligence Settings
agentIntelligenceSettings: {
  enabled: Boolean,
  confidenceThreshold: Number,      // 0.0-1.0
  fallbackBehavior: String,         // "escalate"|"retry"|"default"
  contextWindow: Number,            // Token limit
  personalitySettings: {
    tone: String,                   // "professional"|"friendly"|"casual"
    verbosity: String,              // "concise"|"detailed"|"balanced"
    empathy: Number                 // 0.0-1.0
  }
}
```

---

### **5. PERSONALITY TAB**
**Purpose:** AI agent personality and response templates  
**Key Files:**
- Frontend: `public/js/company-profile-modern.js` (lines ~2876-2900)
- Backend: `routes/company.js`

**Data Structure:**
```javascript
// Agent Personality Settings
agentPersonalitySettings: {
  personality: String,              // "friendly"|"professional"|"casual"
  responseStyle: String,            // "quick"|"detailed"|"conversational"
  
  // Multi-response templates
  responses: {
    greeting: [String],             // Array of greeting variations
    fallback: [String],             // Default responses
    escalation: [String],           // When transferring to human
    closing: [String]               // Call ending responses
  }
}
```

---

### **6. AGENT LOGIC TAB**
**Purpose:** Booking flows and business logic configuration  
**Key Files:**
- Frontend: `public/js/company-profile-modern.js` (lines ~3461-3700)
- Backend: `routes/company.js`

**Data Structure:**
```javascript
// Booking and Business Logic
bookingFlows: [{
  name: String,                     // "Standard Service Call"
  enabled: Boolean,
  steps: [{
    stepType: String,               // "collect_info"|"schedule"|"confirm"
    prompt: String,                 // What AI asks
    required: Boolean,
    validation: String              // Validation rules
  }],
  
  // Scheduling rules
  availability: {
    businessHours: {
      monday: { start: "09:00", end: "17:00" },
      tuesday: { start: "09:00", end: "17:00" },
      // ... other days
    },
    timeZone: String,               // "America/New_York"
    bufferTime: Number              // Minutes between appointments
  }
}]
```

---

## 🗄️ **DATABASE PATTERNS & QUERIES**

### **MongoDB Collections:**
```javascript
// Primary collection (most important)
db.companies.find()              // Company tenant data

// Supporting collections  
db.conversations.find()          // Call logs and history
db.tradecategories.find()        // Global trade categories
db.users.find()                  // Admin user accounts
```

### **Mongoose Model Patterns:**
```javascript
// CORRECT: Find specific company
const company = await Company.findById(companyId);

// CORRECT: Update specific company
const updated = await Company.findByIdAndUpdate(
  companyId, 
  updateData, 
  { new: true, runValidators: true }
);

// WRONG: Global queries without company filter
const companies = await Company.find();  // Don't use for tenant operations
```

### **Company Data Access Patterns:**
```javascript
// Get company with error handling
async function getCompany(companyId) {
  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw new Error('Invalid company ID');
  }
  
  const company = await Company.findById(companyId);
  if (!company) {
    throw new Error('Company not found');
  }
  
  return company;
}
```

---

## 🔧 **ENVIRONMENT & API KEYS**

### **Environment Variables (.env):**
```bash
# Database
MONGODB_URI=mongodb://localhost:27017/clientsvia-production
PORT=3000

# Global API Keys (Platform Level)
OPENAI_API_KEY=sk-...              # Global AI processing
ELEVENLABS_API_KEY=sk_...          # Global voice synthesis
TWILIO_ACCOUNT_SID=AC...           # Global phone service
TWILIO_AUTH_TOKEN=...              # Global phone auth

# Session Management
SESSION_SECRET=random-64-char-string
REDIS_URL=redis://...              # Session storage

# Email Services
SENDGRID_API_KEY=SG...             # Email notifications
```

### **Company-Specific API Keys:**
```javascript
// Companies can override global keys
company.aiSettings.elevenLabs.apiKey     // Company-specific ElevenLabs
company.twilioConfig.accountSid          // Company-specific Twilio
company.twilioConfig.authToken           // Company-specific Twilio auth
```

---

## 🚨 **DEBUGGING COMMON ISSUES**

### **"Company Not Found" Errors:**
```javascript
// Check these in order:
1. Is companyId a valid ObjectId? ObjectId.isValid(companyId)
2. Does company exist in database? Company.findById(companyId)
3. Is URL parameter correct? /company-profile.html?id=VALID_COMPANY_ID
4. Are you using 'companies' collection name (not 'company')?
```

### **"Phone Number Lookup Failed" (Twilio):**
```javascript
// Check both phone number formats:
const company = await Company.findOne({
  $or: [
    { 'twilioConfig.phoneNumber': phoneNumber },      // Legacy single
    { 'twilioConfig.phoneNumbers.phoneNumber': phoneNumber }  // New array
  ]
});
```

### **"Voice Selection Not Working" (ElevenLabs):**
```javascript
// Check voice data structure:
console.log('Voice object:', voice);
// Should have: voice.voice_id (not voice.id)
// Should have: voice.name
// Check: voice.voice_id !== undefined
```

### **"API Key Not Working":**
```javascript
// Check API key priority:
1. Company-specific key (if useOwnApiKey = true)
2. Global platform key (fallback)
3. Environment variable exists and loaded
4. API key format/validity
```

---

## 📁 **FILE STRUCTURE REFERENCE**

### **Frontend Files:**
```
public/
├── company-profile.html              // Main UI (3600+ lines)
├── js/company-profile-modern.js      // Main logic (5400+ lines)
├── css/output.css                    // Tailwind compiled styles
└── favicon.ico                       // Site icon
```

### **Backend Files:**
```
routes/
├── company.js                        // Main company CRUD
├── elevenLabs.js                     // Voice synthesis API
├── twilio.js                         // Phone webhook handling
├── agentSettings.js                  // AI configuration
└── ...other routes

models/
├── Company.js                        // Main company schema
├── ConversationLog.js                // Call history
└── ...other models

services/
├── elevenLabsService.js              // Voice synthesis logic
└── ...other services
```

### **Configuration Files:**
```
├── app.js                            // Express app setup
├── server.js                         // Server startup
├── db.js                            // Database connection
├── package.json                      // Dependencies
├── render.yaml                       // Deployment config
└── .env                             // Environment variables
```

---

## 🔄 **DEPLOYMENT & PRODUCTION**

### **Production Environment:**
- **Platform:** Render.com
- **URL:** https://clientsvia-backend.onrender.com  
- **Database:** MongoDB Atlas
- **Session Storage:** Redis
- **File Storage:** Local (temp audio files)

### **Deployment Process:**
```bash
# 1. Push to GitHub
git add .
git commit -m "Production update"
git push origin main

# 2. Auto-deploy via Render webhook
# 3. Check logs at https://dashboard.render.com
```

### **Production Monitoring:**
```bash
# Health check
curl https://clientsvia-backend.onrender.com/health

# Check logs
# Via Render dashboard or CLI
```

---

## 📞 **PHONE CALL FLOW (Twilio Integration)**

### **Call Flow Sequence:**
```
1. Incoming Call → /api/twilio/voice
2. Company Lookup → By phone number (both formats)
3. AI Greeting → ElevenLabs TTS generation  
4. Speech Recognition → /api/twilio/handle-speech
5. AI Processing → Company-specific logic
6. Response Generation → ElevenLabs TTS
7. Call Continuation → Loop until hangup
```

### **Key Webhook Endpoints:**
```javascript
POST /api/twilio/voice              // Initial call handling
POST /api/twilio/handle-speech      // Speech processing
POST /api/twilio/partial-speech     // Real-time speech updates
```

---

## 🔧 **TROUBLESHOOTING GUIDES**

### **🚨 CRITICAL: Company Profile Data Not Loading**

**SYMPTOM:** Company profile page shows "Loading..." and never loads company data

**MOST COMMON CAUSE:** Missing initialization script in `company-profile.html`

#### **📋 STEP-BY-STEP DIAGNOSIS:**

**1. Check Browser Console:**
```javascript
// Open company-profile.html?id=COMPANY_ID in browser
// Press F12 → Console tab
// Look for these messages:

// ✅ GOOD - Should see:
"🚀 Company Profile page DOMContentLoaded - Starting initialization..."
"✅ Company ID found in URL: 68813026dd95f599c74e49c7"
"📡 Company Profile Manager initialized"
"✅ Company data loaded: {company data object}"

// ❌ BAD - If missing these messages, continue to step 2
```

**2. Check Initialization Script:**
```bash
# Search for the critical initialization script in company-profile.html
grep -n "DOMContentLoaded" public/company-profile.html

# Should find this script near the end of the file:
```
```html
<script>
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Company Profile page DOMContentLoaded - Starting initialization...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    
    if (companyId) {
        console.log('✅ Company ID found in URL:', companyId);
        window.companyId = companyId;
        
        // Initialize CompanyProfileManager
        const manager = new CompanyProfileManager();
        window.companyProfileManager = manager;
        
        manager.init().then(() => {
            console.log('✅ Company Profile Manager initialized successfully');
        }).catch(error => {
            console.error('❌ Failed to initialize Company Profile Manager:', error);
        });
    } else {
        console.error('❌ No company ID found in URL');
    }
});
</script>
```

**3. Fix Missing Initialization Script:**
If the script is missing, add it right before `</body>` in `company-profile.html`:

```html
<!-- Add this script right before </body> -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Company Profile page DOMContentLoaded - Starting initialization...');
    
    // Extract company ID from URL  
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    
    if (companyId) {
        console.log('✅ Company ID found in URL:', companyId);
        
        // Set global company ID
        window.companyId = companyId;
        
        // Initialize CompanyProfileManager
        const manager = new CompanyProfileManager();
        window.companyProfileManager = manager;
        
        // Start initialization
        manager.init().then(() => {
            console.log('✅ Company Profile Manager initialized successfully');
        }).catch(error => {
            console.error('❌ Failed to initialize Company Profile Manager:', error);
        });
    } else {
        console.error('❌ No company ID found in URL');
        // Show error message to user
        document.body.innerHTML = '<div class="p-8 text-center"><h1 class="text-2xl font-bold text-red-600">Error: No company ID provided</h1><p class="text-gray-600 mt-2">Please access this page with a valid company ID.</p></div>';
    }
});
</script>
```

**4. Verify API Endpoint:**
```bash
# Test the API endpoint directly
curl "https://clientsvia-backend.onrender.com/api/company/68813026dd95f599c74e49c7"

# Should return JSON company data
# If 404 or error, check if company ID exists in database
```

**5. Check CompanyProfileManager Class:**
```bash
# Verify CompanyProfileManager is defined in company-profile-modern.js
grep -n "class CompanyProfileManager" public/js/company-profile-modern.js

# Should find the class definition
```

#### **🔍 DEBUGGING CHECKLIST:**

- [ ] **URL has company ID:** `company-profile.html?id=VALID_COMPANY_ID`
- [ ] **DOMContentLoaded script exists** in `company-profile.html` 
- [ ] **CompanyProfileManager class defined** in `company-profile-modern.js`
- [ ] **API endpoint responds** with company data
- [ ] **No JavaScript errors** in browser console
- [ ] **Network tab shows** successful API calls

#### **💡 ROOT CAUSE EXPLANATION:**

The company profile page has these components:
1. `company-profile.html` - The HTML structure and tabs
2. `company-profile-modern.js` - The `CompanyProfileManager` class with `init()` and `loadCompanyData()` methods
3. **MISSING LINK:** A script that extracts the company ID from URL and calls the manager's `init()` method

**Without the initialization script:**
- ✅ HTML loads
- ✅ JavaScript file loads and defines `CompanyProfileManager` 
- ❌ **Nothing calls the manager's `init()` method**
- ❌ **No company data gets fetched**
- ❌ **Page stays on "Loading..."**

**With the initialization script:**
- ✅ HTML loads
- ✅ JavaScript file loads
- ✅ **DOMContentLoaded fires and extracts company ID**
- ✅ **Creates CompanyProfileManager instance**
- ✅ **Calls `manager.init()` which calls `loadCompanyData()`**
- ✅ **Company data loads and populates all tabs**

#### **🚀 QUICK FIX COMMANDS:**

```bash
# 1. Add the initialization script to company-profile.html
# 2. Test locally
open public/company-profile.html?id=68813026dd95f599c74e49c7

# 3. Commit and deploy
git add public/company-profile.html
git commit -m "FIX: Add company profile initialization script

- Added DOMContentLoaded script to extract company ID from URL
- Creates CompanyProfileManager instance and calls init()
- Fixes company profile data not loading issue"

git push origin main
```

#### **🔑 PREVENTION:**

- **Always ensure** there's an initialization script that bridges URL parameters to JavaScript functionality
- **Test the complete flow:** URL → JavaScript initialization → API calls → Data population
- **Never assume** that defining functions is enough - something must CALL them on page load

---

## 🎯 **PERFORMANCE METRICS (Production)**

### **Current Performance:**
- **Database Queries:** 63ms cached, 88ms fresh
- **AI Processing:** ~690ms per request
- **Voice Synthesis:** ~1150ms per TTS generation
- **Total Call Response:** ~2.3 seconds end-to-end

### **Optimization Targets:**
- **Database:** <100ms for all queries
- **AI Response:** <500ms  
- **Voice Generation:** <1000ms
- **Total Response:** <2000ms

---

## 📝 **MAINTENANCE CHECKLIST**

### **Daily:**
- [ ] Monitor production logs for errors
- [ ] Check call processing performance
- [ ] Verify ElevenLabs API quota usage

### **Weekly:**
- [ ] Review database performance
- [ ] Update this manual with new features
- [ ] Check for security vulnerabilities (`npm audit`)

### **Monthly:**
- [ ] Backup production database
- [ ] Review API key usage and limits
- [ ] Performance optimization review

---

## 🆘 **EMERGENCY CONTACTS & RECOVERY**

### **Critical System Failures:**
1. **Database Down:** Check MongoDB Atlas status
2. **API Keys Expired:** Update in production .env
3. **Deployment Failed:** Check Render dashboard logs
4. **Phone Calls Failing:** Verify Twilio webhook URLs

### **Recovery Commands:**
```bash
# Restart production service
# (via Render dashboard manual restart)

# Database connection test
node -e "require('./db.js')"

# API key validation test  
curl -X POST /api/company/TEST_ID/elevenlabs/test-connection
```

---

## 📋 **END-OF-SESSION WORKFLOW (MANDATORY)**

### **🔄 Every Work Session Must End With:**

#### **1. UPDATE THIS MANUAL:**
```bash
# Open the manual and add session log
code CLIENTSVIA_CODING_MANUAL.md

# Add to the top of the SESSION LOG section:
### Session Log - [DATE] ([TIME] PST)
**Task:** [What you worked on]
**Files:** [Key files modified] 
**Findings:** [What you discovered]
**Issues:** [Problems encountered]
**Solutions:** [How you fixed them]
**Lessons:** [Key takeaways]
**Commits:** [Git commit hashes]
```

#### **2. UPDATE PRODUCTION CHECKLIST:**
```bash
# Update the checklist with progress
code production-ready-checklist.md

# Add any new tasks or update existing ones
# Mark completed items with ✅
# Add any new issues found with ❌
```

#### **3. COMMIT AND PUSH:**
```bash
# Stage the documentation files
git add CLIENTSVIA_CODING_MANUAL.md production-ready-checklist.md

# Commit with descriptive message
git commit -m "DOCS: Session log [DATE] - [BRIEF_SUMMARY]

- [Key finding 1]
- [Key finding 2] 
- [Any critical lessons learned]"

# Push to remote repository
git push origin main
```

### **🚨 EMERGENCY DOCUMENTATION PROTOCOL:**

#### **When Production Breaks:**
1. **IMMEDIATELY document the issue** in this manual
2. **Record the exact error messages**
3. **Document the fix steps taken**
4. **Add to "COMMON MISTAKES" section**
5. **Update production checklist with new safeguards**

#### **When Discovering New Architecture:**
1. **Add to appropriate architecture section**
2. **Include code examples**
3. **Cross-reference related files**
4. **Update troubleshooting guides**

### **📝 MANUAL MAINTENANCE CHECKLIST:**

- [ ] Session log added for current work
- [ ] Any mistakes documented with solutions
- [ ] New architecture patterns recorded
- [ ] Security findings updated
- [ ] Production checklist synchronized
- [ ] All changes committed to git
- [ ] Knowledge preserved for future agents

### **🎯 SUCCESS METRICS:**

**This manual is successful when:**
- New agents can understand the codebase quickly
- Common mistakes are avoided through documentation
- Production incidents are resolved faster using recorded solutions
- Architecture decisions are clear and well-documented
- No knowledge is lost between work sessions

---

**🔑 KEY REMINDER:** This manual is the collective memory of the ClientsVia platform. Every mistake, discovery, and solution documented here prevents future agents from repeating the same issues and accelerates development velocity.

**📞 ESCALATION:** If you discover critical security issues or production-breaking problems, document them immediately and ensure the production checklist reflects the urgency.

---

## 🚀 **QUICK START FOR NEW AGENTS**

### **📋 IMMEDIATE ACTION ITEMS:**
1. **Read this manual** - Understand the platform architecture and common issues
2. **Check production status** - Visit https://clientsvia-backend.onrender.com
3. **Review recent session logs** - See what was last worked on
4. **Update at end of session** - Follow the mandatory workflow at the bottom

### **🚨 CRITICAL COMMANDS TO KNOW:**
```bash
# Test production is working
curl https://clientsvia-backend.onrender.com/company-profile.html?id=68813026dd95f599c74e49c7

# Emergency file restore (if you break something)
git checkout HEAD~1 -- path/to/broken/file.js

# Update documentation (mandatory end-of-session)
git add CLIENTSVIA_CODING_MANUAL.md production-ready-checklist.md
git commit -m "DOCS: Session log [DATE] - [SUMMARY]"
git push origin main
```

### **❌ NEVER DO THESE THINGS:**
- Use sed/regex on complex JavaScript files (breaks syntax)
- Remove console.error statements (needed for debugging)
- Work without updating documentation
- Push to production without testing locally
- Modify company data without companyId validation

### **📁 KEY FILES TO KNOW:**
- `CLIENTSVIA_CODING_MANUAL.md` - This file (update after every session)
- `CLIENTSVIA_ARCHITECTURAL_STRUCTURE.md` - **NEW:** Complete platform architecture reference
- `production-ready-checklist.md` - Production status and tasks
- `public/company-profile.html` - Main company profile page
- `public/js/company-profile-modern.js` - Company profile JavaScript
- `routes/company.js` - Main company API endpoints
- `models/Company.js` - Company data schema
