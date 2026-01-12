# TWILIO CONNECTION ARCHITECTURE
## Complete Guide to Per-Company Twilio Integration

> **Purpose:** This document explains how ClientsVia's multi-tenant Twilio integration works, why it's designed this way, and how to troubleshoot common issues.

---

## 📋 TABLE OF CONTENTS

1. [Architecture Overview](#architecture-overview)
2. [Why Per-Company Credentials?](#why-per-company-credentials)
3. [Call Flow: Incoming Call → Company Lookup](#call-flow-incoming-call--company-lookup)
4. [Where Credentials Are Stored](#where-credentials-are-stored)
5. [How the System Finds the Right Company](#how-the-system-finds-the-right-company)
6. [Configuration Locations](#configuration-locations)
7. [Health Check Integration](#health-check-integration)
8. [Troubleshooting Common Issues](#troubleshooting-common-issues)
9. [Code References](#code-references)

---

## 🏗️ ARCHITECTURE OVERVIEW

### The Design Philosophy

ClientsVia is a **multi-tenant platform** where:
- ✅ Each customer company has their **OWN Twilio account**
- ✅ Credentials are stored **per-company in MongoDB**
- ✅ No global Twilio credentials (except optional legacy/admin fallback)
- ✅ Complete isolation between customer accounts

### Visual Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    INCOMING TWILIO CALL                      │
│                  +1-555-123-4567 (phone number)              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────┐
            │  ClientsVia Backend        │
            │  POST /api/twilio/voice    │
            └────────────┬───────────────┘
                         │
                         ▼
            ┌────────────────────────────┐
            │  STEP 1: Extract Phone #   │
            │  "To: +1-555-123-4567"     │
            └────────────┬───────────────┘
                         │
                         ▼
            ┌────────────────────────────────────────┐
            │  STEP 2: MongoDB Lookup                │
            │  Find company with:                    │
            │  twilioConfig.phoneNumbers array       │
            │  containing "+1-555-123-4567"          │
            └────────────┬───────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────────────────┐
            │  STEP 3: Retrieve Company's Credentials│
            │  - twilioConfig.accountSid             │
            │  - twilioConfig.authToken              │
            │  - twilioConfig.phoneNumber (legacy)   │
            │  - twilioConfig.phoneNumbers[] (new)   │
            └────────────┬───────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────────────────┐
            │  STEP 4: Initialize Twilio Client      │
            │  twilio(accountSid, authToken)         │
            │  Using THAT company's credentials      │
            └────────────┬───────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────────────────┐
            │  STEP 5: Handle Call                   │
            │  - Route to AI Agent / Voicemail       │
            │  - Use company's ElevenLabs voice      │
            │  - Access company's knowledge base     │
            │  - Record in company's call archive    │
            └────────────────────────────────────────┘
```

---

## 💡 WHY PER-COMPANY CREDENTIALS?

### Business Requirements

1. **Customer Ownership**
   - Customers bring their own Twilio account
   - They control their phone numbers
   - They see charges on their own Twilio bill
   - You're not responsible for their Twilio costs

2. **Data Isolation**
   - Company A's calls use Company A's Twilio account
   - Company B's calls use Company B's Twilio account
   - No cross-contamination, no shared resources

3. **Compliance & Security**
   - Each customer's call data stays in their Twilio account
   - Meets regulatory requirements for data separation
   - Customer has full audit trail in their own Twilio console

4. **Scalability**
   - No single Twilio account rate limits affecting all customers
   - Each customer's usage is independent
   - No single point of failure

### What This Means Technically

- ❌ **NOT** like SaaS apps with one shared Twilio account
- ✅ **IS** like enterprise software where each tenant brings their own infrastructure
- ✅ Similar to how companies bring their own AWS keys, Stripe keys, etc.

---

## 📞 CALL FLOW: INCOMING CALL → COMPANY LOOKUP

### Step-by-Step Flow

#### 1️⃣ **Call Arrives at Twilio**
```
Incoming call to: +1-555-123-4567
Twilio webhook configured: https://clientsvia-backend.onrender.com/api/twilio/voice
```

#### 2️⃣ **Twilio Sends POST Request**
```http
POST /api/twilio/voice
Content-Type: application/x-www-form-urlencoded

To=+15551234567
From=+15559876543
CallSid=CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
... (many other fields)
```

#### 3️⃣ **Backend Extracts Phone Number**
```javascript
// File: routes/v2twilio.js
const toNumber = req.body.To; // "+15551234567"
const formattedNumber = formatPhoneNumber(toNumber); // "+1-555-123-4567"
```

#### 4️⃣ **MongoDB Query for Company**
```javascript
// Find company that owns this phone number
const company = await v2Company.findOne({
    $or: [
        // New system: multiple phone numbers
        { 'twilioConfig.phoneNumbers': { 
            $elemMatch: { 
                phoneNumber: formattedNumber,
                status: 'active'
            }
        }},
        // Legacy system: single phone number
        { 'twilioConfig.phoneNumber': formattedNumber }
    ]
});
```

**MongoDB Document Structure:**
```json
{
    "_id": "507f1f77bcf86cd799439011",
    "companyName": "Acme Corporation",
    "twilioConfig": {
        "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "authToken": "your_auth_token_here",
        "phoneNumber": "+1-555-123-4567",  // Legacy
        "phoneNumbers": [  // New multi-number support
            {
                "phoneNumber": "+1-555-123-4567",
                "friendlyName": "Main Line",
                "status": "active",
                "isPrimary": true
            },
            {
                "phoneNumber": "+1-555-123-9999",
                "friendlyName": "Support Line",
                "status": "active",
                "isPrimary": false
            }
        ],
        "callRoutingMode": "ai-agent",
        "recordingEnabled": true
    }
}
```

#### 5️⃣ **Create Twilio Client with Company Credentials**
```javascript
// File: utils/twilioClientFactory.js
const twilio = require('twilio');

const client = twilio(
    company.twilioConfig.accountSid,  // Company's SID
    company.twilioConfig.authToken     // Company's token
);
```

#### 6️⃣ **Handle Call Using Company's Settings**
```javascript
// Route based on company's configuration
switch (company.twilioConfig.callRoutingMode) {
    case 'ai-agent':
        // Use company's AI agent settings
        // Use company's ElevenLabs voice
        // Access company's knowledge base
        break;
    case 'voicemail':
        // Route to company's voicemail
        break;
    case 'forward':
        // Forward to company's forward number
        break;
}
```

---

## 💾 WHERE CREDENTIALS ARE STORED

### Database Location

**Model:** `models/v2Company.js`

**Schema:**
```javascript
const twilioConfigSchema = new mongoose.Schema({
    // REQUIRED for incoming calls
    accountSid: { type: String, trim: true, default: null },
    authToken: { type: String, trim: true, default: null },
    
    // Phone numbers this company owns
    phoneNumber: { type: String, trim: true, default: null }, // Legacy
    phoneNumbers: { type: [twilioPhoneNumberSchema], default: [] }, // New
    
    // Optional API credentials (for advanced features)
    apiKey: { type: String, trim: true, default: null },
    apiSecret: { type: String, trim: true, default: null },
    
    // Call routing settings
    callRoutingMode: { 
        type: String, 
        enum: ['ai-agent', 'voicemail', 'forward'], 
        default: 'ai-agent' 
    },
    forwardNumber: { type: String, trim: true, default: null },
    recordingEnabled: { type: Boolean, default: true },
    whisperMessage: { type: String, trim: true, default: null },
    
    // Metadata
    lastUpdated: { type: Date, default: Date.now }
}, { _id: false });
```

### Security Considerations

- ✅ **Encrypted at rest** (MongoDB encryption)
- ✅ **Not exposed in API responses** (filtered out)
- ✅ **Only accessible by admin** (role-based access)
- ✅ **Not logged** (sensitive data redacted from logs)

---

## 🔍 HOW THE SYSTEM FINDS THE RIGHT COMPANY

### Method 1: Phone Number Lookup (Primary)

**Used for:** Incoming calls

**Logic:**
```javascript
// Step 1: Extract phone number from request
const toNumber = req.body.To; // "+15551234567"

// Step 2: Format consistently
const formattedNumber = formatPhoneNumber(toNumber); // "+1-555-123-4567"

// Step 3: Query MongoDB
const company = await v2Company.findOne({
    $or: [
        // Check new multi-number array
        { 'twilioConfig.phoneNumbers': { 
            $elemMatch: { 
                phoneNumber: formattedNumber,
                status: 'active'
            }
        }},
        // Check legacy single number
        { 'twilioConfig.phoneNumber': formattedNumber }
    ]
});

// Step 4: Handle result
if (!company) {
    // No company found = unconfigured phone number
    return sendErrorResponse("No company found for this number");
}

// Step 5: Use company's credentials
const twilioClient = createTwilioClient(company._id);
```

### Method 2: Company ID Lookup (Secondary)

**Used for:** Outbound calls, SMS, admin operations

**Logic:**
```javascript
// Admin knows which company they're working with
const companyId = req.params.companyId;

// Fetch company
const company = await v2Company.findById(companyId);

// Validate Twilio is configured
if (!company.twilioConfig.accountSid || !company.twilioConfig.authToken) {
    return sendErrorResponse("Twilio not configured for this company");
}

// Create client
const twilioClient = createTwilioClient(company._id);
```

### Method 3: Header Lookup (API Calls)

**Used for:** API requests with company context

**Logic:**
```javascript
// Client sends company ID in header
const companyId = req.headers['x-company-id'];

// Or in JWT token
const companyId = req.user.companyId;

// Rest is same as Method 2
```

---

## ⚙️ CONFIGURATION LOCATIONS

### 1. Company Profile → Configuration Tab

**Location:** `public/company-profile.html` → "Configuration" tab

**Fields:**
- Account SID (`twilioAccountSid`)
- Auth Token (`twilioAuthToken`)
- Phone Number (single, legacy)

**UI Screenshot Location:**
```
Configuration Tab
  ├─ Twilio Integration Credentials
  │   ├─ Account SID: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  │   └─ Auth Token: [hidden]
  └─ [Save Configuration] button
```

### 2. AI Agent Settings → Twilio Control Center

**Location:** `public/company-profile.html` → "AI Agent Settings" → "Twilio Control" sub-tab

**Features:**
- Multiple phone numbers management
- Call routing mode (AI Agent / Voicemail / Forward)
- Recording settings
- Phone number status (active/inactive)
- Primary phone designation

**UI Components:**
```
Twilio Control Center
  ├─ Phone Numbers
  │   ├─ +1-555-123-4567 (Primary, Active)
  │   └─ +1-555-123-9999 (Secondary, Active)
  ├─ Call Routing
  │   ├─ ⚪ AI Agent (selected)
  │   ├─ ⚪ Voicemail
  │   └─ ⚪ Forward to: [phone number]
  └─ Recording: [✓] Enabled
```

### 3. Direct Database Access (Admin Only)

**Collection:** `v2companies`

**Query Example:**
```javascript
db.v2companies.findOne({ companyName: "Acme Corporation" })
```

**Update Example:**
```javascript
db.v2companies.updateOne(
    { companyName: "Acme Corporation" },
    { 
        $set: { 
            "twilioConfig.accountSid": "AC...",
            "twilioConfig.authToken": "..."
        }
    }
)
```

---

## 🏥 HEALTH CHECK INTEGRATION

### How Health Check Works Now (After Fix)

**File:** `services/DependencyHealthMonitor.js`

**Logic:**
```javascript
async checkTwilio() {
    // STEP 1: Check for global credentials (legacy/admin)
    let accountSid = process.env.TWILIO_ACCOUNT_SID;
    let authToken = process.env.TWILIO_AUTH_TOKEN;
    let credentialSource = 'global';
    
    // STEP 2: If not found, check MongoDB for ANY company with Twilio
    if (!accountSid || !authToken) {
        const companyWithTwilio = await v2Company.findOne({
            'twilioConfig.accountSid': { $exists: true, $ne: null, $ne: '' },
            'twilioConfig.authToken': { $exists: true, $ne: null, $ne: '' }
        });
        
        if (companyWithTwilio) {
            accountSid = companyWithTwilio.twilioConfig.accountSid;
            authToken = companyWithTwilio.twilioConfig.authToken;
            credentialSource = `company:${companyWithTwilio.companyName}`;
        }
    }
    
    // STEP 3: If still no credentials, return NOT_CONFIGURED (non-critical)
    if (!accountSid || !authToken) {
        return {
            status: 'NOT_CONFIGURED',
            critical: false,
            message: 'Twilio not configured (per-company system)'
        };
    }
    
    // STEP 4: Test real Twilio API
    const client = twilio(accountSid, authToken);
    const account = await client.api.accounts(accountSid).fetch();
    
    // STEP 5: Return status
    return {
        status: account.status === 'active' ? 'HEALTHY' : 'DOWN',
        critical: true,
        details: {
            credentialSource: credentialSource, // "global" or "company:Acme Corp"
            accountStatus: account.status
        }
    };
}
```

### Status Values

| Status | Meaning | Critical? | Action Needed |
|--------|---------|-----------|---------------|
| **HEALTHY** | Real API test passed | No | None |
| **DEGRADED** | API slow (>2s) | No | Monitor |
| **DOWN** | Real API test failed | **Yes** | Fix credentials or Twilio account |
| **NOT_CONFIGURED** | No credentials found | No | Configure if needed |

### Why This Matters

- ❌ **OLD**: Looked for `process.env.TWILIO_ACCOUNT_SID` → Always DOWN (false positive)
- ✅ **NEW**: Queries MongoDB → Tests real API → Accurate status

---

## 🔧 TROUBLESHOOTING COMMON ISSUES

### Issue 1: "No company found for this phone number"

**Symptom:** Incoming calls fail immediately

**Root Cause:** Phone number not configured in database

**Fix:**
1. Go to Company Profile → Configuration tab
2. Enter the phone number in the "Phone Number" field
3. Save configuration
4. OR go to AI Agent Settings → Twilio Control Center
5. Add phone number to the list

**Verify:**
```javascript
// Check in MongoDB
db.v2companies.findOne({
    $or: [
        { 'twilioConfig.phoneNumber': '+1-555-123-4567' },
        { 'twilioConfig.phoneNumbers.phoneNumber': '+1-555-123-4567' }
    ]
})
```

---

### Issue 2: "Twilio authentication failed"

**Symptom:** Calls fail, health check shows DOWN

**Root Cause:** Invalid or expired credentials

**Fix:**
1. Log into customer's Twilio console
2. Verify Account SID and Auth Token
3. Copy correct values
4. Update in Company Profile → Configuration tab
5. Save and test

**Common Mistakes:**
- ❌ Using your own Twilio credentials instead of customer's
- ❌ Copying Account SID from wrong Twilio account
- ❌ Auth Token expired or regenerated

---

### Issue 3: "DEPENDENCY_HEALTH_CRITICAL" alerts

**Symptom:** Constant critical alerts even though Twilio working

**Root Cause:** Health check looking for wrong credentials

**Fix:** ✅ **ALREADY FIXED** (as of commit 8af5de46)

**Verification:**
1. Go to Notification Center → Dashboard
2. Click "Run Health Check"
3. Should show:
   - Twilio: HEALTHY ✅
   - credentialSource: "company:YourCompanyName"

---

### Issue 4: Multiple companies using same phone number

**Symptom:** Calls routing to wrong company

**Root Cause:** Phone number configured in multiple companies

**Fix:**
```javascript
// Find duplicates
db.v2companies.aggregate([
    { $match: { 'twilioConfig.phoneNumber': { $ne: null } } },
    { $group: { 
        _id: '$twilioConfig.phoneNumber', 
        count: { $sum: 1 },
        companies: { $push: '$companyName' }
    }},
    { $match: { count: { $gt: 1 } } }
])
```

**Action:** Remove phone number from incorrect company

---

### Issue 5: Call routing to wrong mode

**Symptom:** Calls going to voicemail instead of AI agent

**Root Cause:** `callRoutingMode` misconfigured

**Fix:**
1. Go to AI Agent Settings → Twilio Control Center
2. Check "Call Routing" section
3. Select "AI Agent" radio button
4. Save settings

**Verify:**
```javascript
// Check in MongoDB
db.v2companies.findOne(
    { companyName: "Acme Corporation" },
    { 'twilioConfig.callRoutingMode': 1 }
)
// Should return: { callRoutingMode: "ai-agent" }
```

---

## 📚 CODE REFERENCES

### Key Files

| File | Purpose |
|------|---------|
| `routes/v2twilio.js` | Main Twilio webhook handler (incoming calls) |
| `models/v2Company.js` | Company schema with twilioConfig |
| `utils/twilioClientFactory.js` | Creates Twilio client with company credentials |
| `services/DependencyHealthMonitor.js` | Health check including Twilio |
| `clients/smsClient.js` | SMS sending with per-company credentials |
| `public/company-profile.html` | Configuration UI |
| `public/js/ai-agent-settings/TwilioControlCenter.js` | Twilio Control Center UI |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/twilio/voice` | POST | Incoming call webhook |
| `/api/twilio/sms` | POST | Incoming SMS webhook |
| `/api/companies/:companyId/twilio/config` | GET | Get Twilio config |
| `/api/companies/:companyId/twilio/config` | PUT | Update Twilio config |
| `/api/admin/notifications/dependency-health` | GET | Check Twilio health |

### Database Queries

**Find company by phone number:**
```javascript
const company = await v2Company.findOne({
    $or: [
        { 'twilioConfig.phoneNumbers.phoneNumber': phoneNumber },
        { 'twilioConfig.phoneNumber': phoneNumber }
    ]
});
```

**Check if company has Twilio configured:**
```javascript
const hasConfig = company.twilioConfig.accountSid && 
                  company.twilioConfig.authToken;
```

**Get all companies with Twilio:**
```javascript
const companies = await v2Company.find({
    'twilioConfig.accountSid': { $exists: true, $ne: null, $ne: '' }
});
```

---

## 🎯 QUICK REFERENCE CHECKLIST

When setting up a new company:

- [ ] Customer creates their own Twilio account
- [ ] Customer purchases phone number in Twilio
- [ ] Customer configures webhook: `https://clientsvia-backend.onrender.com/api/twilio/voice`
- [ ] Admin enters Account SID in Company Profile → Configuration
- [ ] Admin enters Auth Token in Company Profile → Configuration
- [ ] Admin enters Phone Number in Company Profile → Configuration
- [ ] (Optional) Admin configures routing in AI Agent Settings → Twilio Control Center
- [ ] Test incoming call to verify routing
- [ ] Verify health check shows HEALTHY

---

## 🚨 IMPORTANT REMINDERS

### ⚠️ DO NOT:
- ❌ Use global Twilio credentials for customer calls
- ❌ Share Twilio credentials between customers
- ❌ Store credentials in environment variables (use database)
- ❌ Expose credentials in API responses or logs

### ✅ DO:
- ✅ Each customer has their own Twilio account
- ✅ Store credentials per-company in MongoDB
- ✅ Validate credentials before storing
- ✅ Test with real API calls (not just format validation)
- ✅ Keep this document updated when architecture changes

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-23  
**Author:** Engineering Team  
**For Questions:** Reference this doc first, then check code files listed above

---

## 📖 RELATED DOCUMENTATION

- [REFACTOR_PROTOCOL.md](./REFACTOR_PROTOCOL.md) - Multi-tenant safety standards
- [ERROR-INTELLIGENCE-SYSTEM.md](./ERROR-INTELLIGENCE-SYSTEM.md) - Error handling & notifications
- [NAVIGATION-MAP.md](./NAVIGATION-MAP.md) - UI locations for configuration

---

*Remember: If Twilio isn't working, check the company's credentials FIRST. 99% of Twilio issues are misconfigured or missing credentials for that specific company.*

