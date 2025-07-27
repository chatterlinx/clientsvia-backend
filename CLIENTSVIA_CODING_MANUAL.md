# ClientsVia Platform - Developer Coding Manual

**Version:** 1.0  
**Last Updated:** July 27, 2025 - Console.log cleanup & Security validation session  
**Platform Status:** LIVE IN PRODUCTION  
**Production URL:** https://clientsvia-backend.onrender.com    

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

**📚 This manual is a living document - update it whenever you add new features or discover new patterns!**

**🔄 Last Updated:** July 27, 2025  
**👨‍💻 Maintained by:** Development Team  
**📋 Version:** 1.0 - Initial Complete Manual
