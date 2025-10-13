# 🏗️ MULTI-TENANT ARCHITECTURE

**ClientsVia.ai** - Enterprise-Grade Multi-Tenant AI Receptionist Platform

---

## 🎯 **CORE PRINCIPLE:**

> **Every company operates in complete isolation. Company A NEVER sees Company B's data. PERIOD.**

---

## 📐 **ARCHITECTURE LAYERS**

### **LAYER 1: GLOBAL AI BRAIN** (Platform-Wide Templates)

```
┌─────────────────────────────────────────────────────────────┐
│             GLOBAL INSTANT RESPONSE TEMPLATES               │
│                  (Shared Structure Only)                    │
├─────────────────────────────────────────────────────────────┤
│  • Universal AI Brain (default for all industries)         │
│  • Industry-Specific Templates (Plumbing, HVAC, etc.)      │
│  • 103 Universal Categories + Scenarios                     │
│  • AI Behaviors (tone, pace, emotion)                      │
│  • Action Hooks (escalate, offer_scheduling, etc.)         │
│  • Filler Words (um, uh, like - to be stripped)            │
│  • Urgency Keywords (emergency, flooding - with weights)   │
│  • Variable Definitions (structure, NOT values)            │
│                                                             │
│  ✅ CONTAINS: Logic, patterns, conversation flows          │
│  ❌ NEVER CONTAINS: Company names, prices, secrets         │
└─────────────────────────────────────────────────────────────┘
                            ⬇️
                     CLONE / INHERIT
                            ⬇️
┌─────────────────────────────────────────────────────────────┐
│          COMPANY-SPECIFIC PROFILE (companyId: XYZ)          │
│                    (100% Isolated)                          │
├─────────────────────────────────────────────────────────────┤
│  configuration: {                                           │
│    clonedFrom: <templateId>,                               │
│    clonedAt: <timestamp>,                                  │
│                                                             │
│    variables: {                                             │
│      companyName: "Joe's Plumbing",    ← PRIVATE           │
│      servicecallprice: "$125",         ← PRIVATE           │
│      phone: "+1-239-555-0100",         ← PRIVATE           │
│      hours: "Mon-Fri 8am-5pm"          ← PRIVATE           │
│    },                                                       │
│                                                             │
│    fillerWords: {                                           │
│      inherited: ['um', 'uh', 'like'],  ← FROM TEMPLATE     │
│      custom: ['y'all', 'reckon']       ← COMPANY-SPECIFIC  │
│    },                                                       │
│                                                             │
│    urgencyKeywords: {                                       │
│      inherited: [{word: 'emergency', weight: 0.5}],        │
│      custom: [{word: 'backup', weight: 0.3}]               │
│    },                                                       │
│                                                             │
│    scenarios: [                                             │
│      { /* Cloned from template with {variable} placeholders */ }│
│    ]                                                        │
│  },                                                         │
│                                                             │
│  aiAgentLogic: {                                            │
│    knowledgeManagement: { /* Company Q&A - PRIVATE */ }    │
│  },                                                         │
│                                                             │
│  twilioConfig: {                                            │
│    phoneNumber: "+1-239-555-0100"      ← UNIQUE            │
│  }                                                          │
│}                                                            │
│                                                             │
│  ✅ ISOLATED: Complete data separation per company         │
│  ✅ PRIVATE: Secrets, pricing, knowledge base              │
│  ✅ INHERITED: Structure from template (can customize)     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔒 **ISOLATION GUARANTEES**

### **1. DATABASE QUERIES (Mongoose)**

#### ✅ **CORRECT:**
```javascript
// Always filter by companyId
const company = await Company.findById(companyId);
const scenarios = await Scenario.find({ companyId });
const knowledge = await CompanyKnowledgeQnA.find({ companyId });
```

#### ❌ **WRONG:**
```javascript
// NEVER query without companyId filter
const companies = await Company.find({}); // DANGEROUS - returns ALL
const scenarios = await Scenario.find({}); // DANGEROUS - leaks data
```

---

### **2. REDIS CACHING**

#### ✅ **CORRECT:**
```javascript
// Always scope Redis keys with companyId
await redisClient.set(`company:${companyId}`, data);
await redisClient.get(`company:${companyId}`);
await redisClient.setex(`readiness:${companyId}`, 30, score);
await redisClient.del(`company:${companyId}:scenarios`);
```

#### ❌ **WRONG:**
```javascript
// NEVER use global keys without companyId
await redisClient.set('scenarios', data); // DANGEROUS - shared across all
await redisClient.get('company-data'); // DANGEROUS - no isolation
```

---

### **3. TWILIO ROUTING**

```javascript
// Incoming Call Flow (100% Isolated)

1. Twilio receives call on phone number: +1-239-555-0100
   ↓
2. Lookup company by phone number:
   const company = await Company.findOne({
     'twilioConfig.phoneNumber': '+1-239-555-0100'
   });
   ↓
3. Load ONLY that company's data:
   - configuration.variables
   - configuration.scenarios
   - aiAgentLogic.knowledgeManagement
   ↓
4. Run AI agent with company-specific context
   ↓
5. Replace {placeholders} with company variables:
   "{companyName}" → "Joe's Plumbing"
   "{servicecallprice}" → "$125"
   ↓
6. NEVER access other companies' data
```

---

### **4. KNOWLEDGE BASE HIERARCHY (Per Company)**

When a call comes in for `companyId: ABC123`:

```
Priority 1: Company Q&A (80% threshold)
├─ Query: CompanyKnowledgeQnA.find({ companyId: 'ABC123' })
├─ "Where are we located?" → "123 Main St, Fort Myers, FL"
├─ "How much for drain cleaning?" → "$125"
└─ 100% PRIVATE to this company

Priority 2: Cloned Scenarios (from Global Template)
├─ Use company.configuration.scenarios
├─ Replace {companyName} with "Joe's Plumbing"
├─ Replace {servicecallprice} with "$125"
└─ Customized for this company

Priority 3: Fallback (Generic)
└─ "I'll connect you with someone who can help"
```

---

## 🛡️ **SECURITY ENFORCEMENT**

### **Middleware: Company Access Validation**

```javascript
// /middleware/companyAccess.js

async function validateCompanyAccess(req, res, next) {
    const { companyId } = req.params;
    const user = req.user;

    // Verify user has access to this company
    if (user.role !== 'admin' && user.companyId !== companyId) {
        return res.status(403).json({
            error: 'Unauthorized',
            message: 'You do not have access to this company'
        });
    }

    next();
}
```

### **Apply to All Company Routes:**

```javascript
// /routes/company/*.js

router.use('/:companyId/*', authMiddleware, validateCompanyAccess);

// Now every route automatically enforces access control
router.get('/:companyId/configuration', ...);
router.patch('/:companyId/configuration/variables', ...);
router.get('/:companyId/knowledge-management', ...);
```

---

## 📊 **DATA FLOW EXAMPLES**

### **Example 1: Variable Updates**

```javascript
// Company A updates their service price
PATCH /api/company/ABC123/configuration/variables
Body: { servicecallprice: "150" }

// Flow:
1. Validate user has access to companyId: ABC123
2. Load company = await Company.findById('ABC123')
3. Update company.configuration.variables.servicecallprice = "150"
4. Save company
5. Clear Redis cache: await redisClient.del(`company:ABC123`)
6. Invalidate readiness cache: await redisClient.del(`readiness:ABC123`)

// Result: Only Company A affected, Company B unchanged
```

### **Example 2: Template Cloning**

```javascript
// Company B clones "Universal AI Brain" template

POST /api/company/XYZ789/configuration/sync
Body: { templateId: "TEMPLATE_001" }

// Flow:
1. Load template = await GlobalInstantResponseTemplate.findById('TEMPLATE_001')
2. Load company = await Company.findById('XYZ789')
3. Copy template.scenarios → company.configuration.scenarios (deep clone)
4. Copy template.fillerWords → company.configuration.fillerWords.inherited
5. Copy template.urgencyKeywords → company.configuration.urgencyKeywords.inherited
6. Copy template.variableDefinitions → company.configuration.variableDefinitions
7. Set company.configuration.clonedFrom = 'TEMPLATE_001'
8. Set company.configuration.clonedAt = new Date()
9. Save company
10. Clear cache

// Result: Company B has independent copy of template structure
//         Changes to Company B do NOT affect Company A or template
```

### **Example 3: AI Agent Call Processing**

```javascript
// Incoming call to +1-239-555-0100 (Company A)

1. Twilio webhook: POST /api/twilio/voice
   Body: { From: "+1-555-1234", To: "+1-239-555-0100", CallSid: "CA..." }

2. Lookup company:
   company = await Company.findOne({ 'twilioConfig.phoneNumber': '+1-239-555-0100' })
   // Returns: Company A only

3. Load company-specific data:
   - scenarios = company.configuration.scenarios
   - variables = company.configuration.variables
   - fillerWords = [...company.configuration.fillerWords.inherited, ...company.configuration.fillerWords.custom]
   - urgencyKeywords = [...company.configuration.urgencyKeywords.inherited, ...company.configuration.urgencyKeywords.custom]

4. Initialize HybridScenarioSelector:
   selector = new HybridScenarioSelector(fillerWords, urgencyKeywords)

5. User says: "I need to schedule an appointment"

6. AI Matching:
   - Normalize phrase: "need schedule appointment"
   - Match against company.configuration.scenarios
   - Find: "Book Appointment" scenario (score: 0.92)

7. Generate response:
   - Get quickReply: "I can help you schedule with {companyName}!"
   - Replace placeholders:
     {companyName} → company.configuration.variables.companyName → "Joe's Plumbing"
   - Final: "I can help you schedule with Joe's Plumbing!"

8. Check Company Q&A:
   qnas = await CompanyKnowledgeQnA.find({ companyId: company._id })
   // Returns ONLY Company A's knowledge base

9. TTS + Response:
   - Use company.aiAgentLogic.voiceSettings
   - Generate TwiML
   - Return to Twilio

// At NO POINT does this process access Company B's data
```

---

## ⚙️ **MONGOOSE + REDIS PERFORMANCE**

### **Cache Strategy:**

```javascript
// Read Flow (sub-50ms target)
async function getCompanyData(companyId) {
    const cacheKey = `company:${companyId}`;
    
    // 1. Check Redis cache (sub-5ms)
    let company = await redisClient.get(cacheKey);
    if (company) {
        return JSON.parse(company);
    }
    
    // 2. Cache miss - query Mongoose (10-50ms)
    company = await Company.findById(companyId).lean();
    
    // 3. Cache to Redis (TTL: 1 hour)
    await redisClient.setex(cacheKey, 3600, JSON.stringify(company));
    
    return company;
}

// Write Flow
async function updateCompanyData(companyId, updates) {
    // 1. Update Mongoose (source of truth)
    const company = await Company.findByIdAndUpdate(
        companyId,
        { $set: updates },
        { new: true }
    );
    
    // 2. Invalidate Redis cache (force refresh)
    await redisClient.del(`company:${companyId}`);
    await redisClient.del(`readiness:${companyId}`);
    
    return company;
}
```

---

## 🧪 **TESTING ISOLATION**

### **Critical Test Cases:**

1. **API Endpoint Isolation**
   - Company A cannot access Company B's `/configuration`
   - Company A cannot access Company B's `/knowledge-management`
   - Company A cannot access Company B's `/scenarios`

2. **Redis Cache Isolation**
   - `company:A` cache does not contain Company B data
   - `readiness:A` score is independent of Company B
   - No global keys without `companyId` prefix

3. **Twilio Routing Isolation**
   - Phone number `+1-239-555-0100` routes to Company A only
   - Phone number `+1-239-555-0200` routes to Company B only
   - No cross-company routing

4. **Knowledge Base Isolation**
   - `CompanyKnowledgeQnA.find({ companyId: 'A' })` returns only Company A's Q&A
   - Company B's location is NEVER returned to Company A caller

5. **Variable Isolation**
   - Updating Company A's `servicecallprice` does NOT affect Company B
   - Company A's `{companyName}` resolves to "Joe's Plumbing"
   - Company B's `{companyName}` resolves to "Smith's HVAC"

---

## 🚨 **COMMON PITFALLS TO AVOID**

### ❌ **DON'T:**

```javascript
// 1. Global queries without companyId
const allCompanies = await Company.find({});
const allScenarios = await Scenario.find({});

// 2. Shared Redis keys
await redisClient.set('scenarios', data);
await redisClient.get('company-config');

// 3. Cross-company references
const otherCompany = await Company.findOne({ companyName: 'Other Company' });

// 4. Hardcoded values that should be per-company
const servicePrice = '$125'; // Should be company.configuration.variables.servicecallprice
```

### ✅ **DO:**

```javascript
// 1. Always filter by companyId
const company = await Company.findById(companyId);
const scenarios = await Scenario.find({ companyId });

// 2. Scope Redis keys with companyId
await redisClient.set(`company:${companyId}:scenarios`, data);
await redisClient.get(`company:${companyId}`);

// 3. Use middleware to enforce access control
router.use('/:companyId/*', authMiddleware, validateCompanyAccess);

// 4. Use company-specific variables
const servicePrice = company.configuration.variables.servicecallprice;
```

---

## 📋 **CHECKLIST FOR NEW FEATURES**

Before deploying any new feature, verify:

- [ ] All Mongoose queries filter by `companyId`
- [ ] All Redis keys include `company:${companyId}` prefix
- [ ] API endpoints validate user has access to `companyId`
- [ ] No global variables that should be per-company
- [ ] Twilio routing verified with multiple test companies
- [ ] Knowledge base queries scoped to `companyId`
- [ ] Variable replacement uses company-specific values
- [ ] Isolation tests written and passing
- [ ] No cross-company data leakage in logs
- [ ] Cache invalidation clears only affected company

---

## 🎓 **DEVELOPER GUIDELINES**

### **When Adding a New API Endpoint:**

```javascript
// Template for company-scoped endpoint

router.get('/:companyId/new-feature', 
    authMiddleware,              // 1. Authenticate user
    validateCompanyAccess,       // 2. Validate access to companyId
    async (req, res) => {
        try {
            const { companyId } = req.params;
            
            // 3. Always query with companyId filter
            const company = await Company.findById(companyId);
            if (!company) {
                return res.status(404).json({ error: 'Company not found' });
            }
            
            // 4. Check Redis cache (scoped to companyId)
            const cacheKey = `company:${companyId}:new-feature`;
            let data = await redisClient.get(cacheKey);
            
            if (!data) {
                // 5. Load from database (scoped to companyId)
                data = await SomeModel.find({ companyId });
                
                // 6. Cache with company-scoped key
                await redisClient.setex(cacheKey, 3600, JSON.stringify(data));
            } else {
                data = JSON.parse(data);
            }
            
            // 7. Return company-specific data
            res.json({ success: true, data });
            
        } catch (error) {
            console.error(`[NEW FEATURE] Error for company ${req.params.companyId}:`, error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
```

---

## 🔥 **PERFORMANCE TARGETS**

- **Redis Cache Hit:** < 5ms
- **Mongoose Query (cached):** < 50ms
- **Mongoose Query (uncached):** < 150ms
- **Twilio Call Initialization:** < 200ms
- **AI Scenario Matching:** < 100ms
- **Total Call Response Time:** < 500ms

---

## 📞 **SUPPORT**

If you have questions about multi-tenant architecture:

1. Review this document
2. Check `/tests/multi-tenant-isolation.test.js`
3. Search codebase for patterns
4. Ask senior developers

**Remember: When in doubt, scope by `companyId`!** 🎯

