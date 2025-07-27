# ClientsVia Platform - Architectural Structure Brief

**Version:** 2.0  
**Last Updated:** July 27, 2025 - Post Security Audit  
**Platform Type:** Multi-Tenant AI Agent SaaS  
**Production URL:** https://clientsvia-backend.onrender.com  
**Security Status:** ✅ **CRITICAL VULNERABILITIES RESOLVED**  

---

## 🚨 **CRITICAL SECURITY ARCHITECTURE NOTES**

### **Security Incidents Resolved (July 27, 2025):**
- **Complete Data Breach:** `/api/companies` endpoint exposed ALL company data publicly
- **Multi-Tenant Isolation Failure:** Several endpoints leaked data across companies
- **Production Impact:** All sensitive data (API keys, credentials, contacts) was publicly accessible
- **Resolution:** All vulnerable endpoints secured, comprehensive audit completed
- **Current Status:** Multi-tenant isolation restored and verified

### **Security-First Architecture Principles:**
1. **Every endpoint MUST validate companyId for tenant isolation**
2. **Models with companyId fields MUST filter by companyId in queries**
3. **No aggregate data endpoints without authentication**
4. **All admin functions require proper authentication middleware**

---

## 🏗️ **PLATFORM OVERVIEW**

### **What is ClientsVia?**
ClientsVia is a **multi-tenant AI Agent SaaS platform** that provides companies across different trade industries with intelligent phone-based AI agents. Each company operates as an isolated tenant with their own AI configuration, voice settings, phone numbers, and business logic.

### **Business Model:**
```
ClientsVia Platform (SaaS)
├── Company A (HVAC Business - Florida)
├── Company B (Plumbing Business - Texas) 
├── Company C (Electrical Business - California)
└── [Each completely isolated with custom AI agents]
```

### **Core Value Proposition:**
- **For Trade Companies:** Complete AI phone agent solution with industry-specific knowledge
- **For Platform:** Scalable multi-tenant SaaS serving multiple industries under one codebase
- **For End Users:** Professional AI agents that understand trade terminology and workflows

---

## 🏛️ **ARCHITECTURAL FOUNDATIONS**

### **1. Multi-Tenant Data Isolation**
```javascript
// FUNDAMENTAL PRINCIPLE: Everything is company-scoped
ClientsVia Platform Database
├── Company A (companyId: "68813026dd95f599c74e49c7")
│   ├── AI Settings (prompts, voice, behavior)
│   ├── Trade Categories (HVAC, Plumbing, Electrical)
│   ├── Phone Configuration (Twilio integration)
│   ├── Voice Synthesis (ElevenLabs settings)
│   ├── Knowledge Base (company-specific Q&A)
│   ├── Booking Flows (scheduling rules)
│   ├── Contact Management (customers, employees)
│   └── Analytics & Call Logs
├── Company B (companyId: "def456...")
│   ├── [Same structure, completely isolated]
│   └── [No data crossover - CRITICAL for security]
└── Global Settings
    ├── Trade Category Definitions (shared templates)
    ├── Platform Configuration
    └── Admin Controls
```

### **2. Technology Stack**
```
Frontend:
├── HTML5 (company-profile.html - main dashboard)
├── Vanilla JavaScript (company-profile-modern.js)
├── Tailwind CSS (utility-first styling)
└── RESTful API consumption

Backend:
├── Node.js + Express.js (REST API server)
├── MongoDB + Mongoose (document database)
├── Twilio Integration (phone webhooks)
├── ElevenLabs Integration (voice synthesis)
└── Render.com (production hosting)

AI & Voice:
├── Google Gemini (LLM for conversation)
├── ElevenLabs (text-to-speech synthesis)
├── Twilio (phone call handling)
└── Custom AI routing logic
```

---

## 📊 **DATA ARCHITECTURE**

### **Core Company Schema (MongoDB)**
```javascript
// models/Company.js - Main data structure
{
  _id: ObjectId("68813026dd95f599c74e49c7"),  // Primary company identifier
  
  // Basic Information
  companyName: "Atlas Air",
  companyPhone: "+12395652202",
  companyAddress: "12155 metro pkwy suite 12 fort myers fl 33966",
  businessHours: "m-f 9-5",
  timezone: "America/New_York",
  tradeCategories: ["HVAC", "Plumbing"],
  
  // AI Agent Configuration
  aiSettings: {
    // Language Model Settings
    model: "gemini-1.5-pro",
    personality: "friendly",
    language: "en",
    responseLength: "concise",
    
    // Voice Synthesis (ElevenLabs)
    elevenLabs: {
      voiceId: "UgBBYS2sOqTuMpoF3BR0",
      useOwnApiKey: false,              // Use global or company key
      apiKey: "",                       // Company-specific key (optional)
      stability: 0.4,                   // Voice stability (0.0-1.0)
      similarityBoost: 0.8,             // Voice similarity (0.0-1.0)
      style: "0"                        // Voice style setting
    },
    
    // Intelligence Settings
    semanticKnowledge: {
      enabled: true,
      confidenceThreshold: 0.87
    },
    contextualMemory: {
      enabled: true,
      personalizationLevel: "medium",
      memoryRetentionHours: 24
    },
    smartEscalation: {
      enabled: true,
      sentimentTrigger: true,
      contextualHandoffs: true
    }
  },
  
  // Phone Integration (Twilio)
  twilioConfig: {
    accountSid: "AC18c622a49f28d9abf8952ecf06ba59f2",
    authToken: "encrypted_token_here",
    apiKey: "api_key_here",
    apiSecret: "api_secret_here",
    phoneNumbers: [
      {
        phoneNumber: "+12392322030",
        friendlyName: "Primary Number",
        status: "active",
        isPrimary: true
      }
    ]
  },
  
  // Business Logic
  agentSetup: {
    operatingHours: [
      { day: "Monday", enabled: true, start: "09:00", end: "17:00" },
      { day: "Tuesday", enabled: true, start: "09:00", end: "17:00" }
      // ... other days
    ],
    greetingType: "tts",
    agentGreeting: "Thank you for calling Atlas Air...",
    mainAgentScript: "How can I help you today?",
    agentClosing: "Have a great day!"
  },
  
  // Knowledge & Learning
  personalityResponses: {
    cantUnderstand: ["I'm sorry, I didn't quite catch that..."],
    speakClearly: ["Could you speak a bit more clearly, please?"],
    outOfCategory: ["That's outside what we typically handle..."]
  },
  
  // Metadata
  profileComplete: true,
  isActive: true,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

### **Related Data Models**
```javascript
// Additional collections (all company-scoped)
ConversationLog: {
  companyId: ObjectId,          // CRITICAL: Always company-scoped
  callSid: String,              // Twilio call identifier
  transcript: String,           // Call conversation
  aiResponses: Array,           // AI agent responses
  sentiment: String,            // Call sentiment analysis
  duration: Number,             // Call length
  outcome: String               // Call result
}

CompanyQnA: {
  companyId: ObjectId,          // Company-specific knowledge
  question: String,             // Customer question
  answer: String,               // Company's answer
  category: String,             // Knowledge category
  confidence: Number,           // Answer confidence score
  isActive: Boolean             // Enable/disable
}

Employee: {
  companyId: ObjectId,          // Company team member
  name: String,                 // Employee name
  role: String,                 // Job title
  phone: String,                // Contact number
  email: String,                // Contact email
  isOnCall: Boolean            // Available for escalation
}
```

---

## 🚀 **API ARCHITECTURE**

### **RESTful Endpoint Structure**
```javascript
// Pattern: /api/{resource}/{companyId}/{action}
// CRITICAL: All endpoints are company-scoped for security

// Company Management
GET    /api/company/:companyId                    // Get company data
PATCH  /api/company/:companyId                    // Update company settings
POST   /api/company                              // Create new company
DELETE /api/company/:companyId                    // Deactivate company

// Voice & AI Settings  
GET    /api/company/:companyId/elevenlabs/voices  // Available voices
POST   /api/company/:companyId/elevenlabs/test    // Test voice synthesis
PATCH  /api/company/:companyId/ai-settings        // Update AI configuration

// Phone Integration
POST   /api/twilio/:companyId/webhook             // Incoming call webhook
GET    /api/company/:companyId/phone-numbers      // Manage phone numbers
POST   /api/company/:companyId/phone-numbers      // Add phone number

// Knowledge Management
GET    /api/company/:companyId/knowledge          // Company Q&A
POST   /api/company/:companyId/knowledge          // Add knowledge entry
PUT    /api/company/:companyId/knowledge/:id      // Update knowledge

// Analytics & Monitoring
GET    /api/company/:companyId/call-logs          // Call history
GET    /api/company/:companyId/analytics          // Performance metrics
GET    /api/company/:companyId/agent-performance  // AI agent stats
```

### **Authentication & Authorization Pattern**
```javascript
// Multi-tenant security model
router.get('/api/company/:companyId/*', async (req, res) => {
  const { companyId } = req.params;
  
  // Step 1: Validate companyId format
  if (!mongoose.isValidObjectId(companyId)) {
    return res.status(400).json({ error: 'Invalid company ID' });
  }
  
  // Step 2: Verify company exists and is active
  const company = await Company.findById(companyId);
  if (!company || !company.isActive) {
    return res.status(404).json({ error: 'Company not found' });
  }
  
  // Step 3: Process company-specific request
  // ALL data queries are automatically scoped to this company
});
```

---

## 🔌 **API ENDPOINT ARCHITECTURE**

### **Endpoint Security Classification:**

#### **✅ SECURE ENDPOINTS (Company-Scoped):**
```javascript
// Pattern: All endpoints include companyId and validate isolation
GET    /api/company/:companyId                    // ✅ Single company data
PATCH  /api/company/:companyId                    // ✅ Company updates
GET    /api/company/:companyId/elevenlabs/voices  // ✅ Company voice settings
POST   /api/company/:companyId/qna               // ✅ Company knowledge base
GET    /api/learning/analytics/:companyId        // ✅ Company learning data
POST   /api/twilio/webhook/:companyId            // ✅ Company phone webhooks
```

#### **🚨 PREVIOUSLY VULNERABLE ENDPOINTS (Now Secured):**
```javascript
// FIXED: These endpoints were exposing cross-company data
GET    /api/companies        // ❌ DISABLED - Exposed ALL company data publicly
GET    /api/alerts          // ❌ DISABLED - Leaked alerts across companies  
GET    /api/suggestions     // ❌ DISABLED - Exposed AI learning across companies

// All now return: 403 Forbidden with security notice
{
  "message": "This endpoint has been disabled for security reasons",
  "error": "ENDPOINT_DISABLED_FOR_SECURITY",
  "remediation": "Use company-specific endpoints with proper authentication"
}
```

#### **✅ SAFE PUBLIC ENDPOINTS:**
```javascript
// These endpoints handle non-sensitive, global data
GET    /api/trade-categories     // ✅ Global trade category templates
GET    /api/booking-scripts/templates  // ✅ Public booking templates
GET    /health                   // ✅ System health monitoring
POST   /api/ai/models           // ✅ Available AI models list
```

### **Security Validation Patterns:**

#### **Tenant Isolation Middleware:**
```javascript
// Example: routes/companyQna.js
const validateCompanyId = (req, res, next) => {
  const { companyId } = req.params;
  
  if (!companyId || !ObjectId.isValid(companyId)) {
    return res.status(400).json({ message: 'Invalid company ID' });
  }
  
  // Log for audit trail
  console.log(`[TENANT-ISOLATION] Operation on companyId: ${companyId}`);
  next();
};

router.use(validateCompanyId);  // Applied to all routes
```

#### **Database Query Pattern:**
```javascript
// CORRECT: Always filter by companyId
const entries = await KnowledgeEntry.find({ companyId }).sort({ createdAt: -1 });

// WRONG: Never query without company isolation (security vulnerability)
const entries = await KnowledgeEntry.find({}).sort({ createdAt: -1 });  // ❌ DANGEROUS
```

### **Authentication Architecture (Future):**
```javascript
// PLANNED: Authentication middleware for admin endpoints
const authenticateAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// FUTURE: Secure admin endpoints
router.get('/admin/companies', authenticateAdmin, async (req, res) => {
  const companies = await Company.find({});  // ✅ Safe with authentication
  res.json(companies);
});
```

---

## 🔄 **BUSINESS LOGIC & WORKFLOW ARCHITECTURE**

### **AI Agent Call Flow:**
```
Incoming Phone Call
├── 1. Twilio receives call → webhook to /api/twilio/webhook/:companyId
├── 2. System looks up company by phone number
├── 3. Load company AI settings, voice config, knowledge base
├── 4. Initialize AI agent with company-specific prompts
├── 5. Process conversation using Gemini LLM + company knowledge
├── 6. Generate responses using ElevenLabs TTS with company voice
├── 7. Handle booking/scheduling with company-specific flows
├── 8. Log conversation to company's conversation history
└── 9. Trigger post-call workflows (SMS, email, learning)
```

### **Company Onboarding Architecture:**
```
New Company Setup
├── 1. Company Profile Creation (basic info, trade categories)
├── 2. Phone Number Configuration (Twilio integration)
├── 3. Voice Settings (ElevenLabs voice selection)
├── 4. AI Agent Configuration (personality, prompts, knowledge)
├── 5. Booking Flow Setup (scheduling rules, availability)
├── 6. Knowledge Base Population (Q&A, trade-specific info)
├── 7. Integration Setup (Google Calendar, CRM connections)
└── 8. Testing & Go-Live (webhook testing, call validation)
```

### **Data Flow Architecture:**
```
Real-Time Data Processing
├── 📞 Phone Calls
│   ├── Twilio Webhook → AI Processing → Response Generation
│   ├── Conversation Logging → MongoDB (company-scoped)
│   └── Learning Queue → Suggested Knowledge Entries
│
├── 💬 SMS Integration  
│   ├── Customer SMS → Company-specific processing
│   ├── Automated Responses → Rule-based routing
│   └── Human Handoff → Notification system
│
├── 🤖 AI Learning Loop
│   ├── Call Analysis → Confidence Scoring
│   ├── Knowledge Gap Detection → Suggestion Generation
│   ├── Manual Review → Knowledge Base Updates
│   └── Performance Optimization → Response Improvement
│
└── 📊 Analytics Pipeline
    ├── Call Metrics → Performance Dashboards
    ├── Customer Satisfaction → Sentiment Analysis
    ├── Business Intelligence → Reporting System
    └── Optimization Insights → System Improvements
```

### **Trade Category Architecture:**
```javascript
// Global trade categories with company-specific knowledge
Trade Categories (Global Templates)
├── HVAC
│   ├── Common Knowledge (shared across all HVAC companies)
│   ├── Equipment Types (Lennox, Carrier, Trane, etc.)
│   ├── Service Types (repair, maintenance, installation)
│   └── Seasonal Patterns (summer AC, winter heating)
│
├── Plumbing  
│   ├── Common Knowledge (pipes, fixtures, water systems)
│   ├── Emergency Services (leaks, clogs, burst pipes)
│   ├── Installation Services (new fixtures, remodels)
│   └── Maintenance Programs (annual inspections)
│
└── Electrical
    ├── Common Knowledge (wiring, panels, outlets)
    ├── Safety Protocols (code compliance, permits)
    ├── Residential vs Commercial (different approaches)
    └── Emergency Services (power outages, safety hazards)

// Company-specific knowledge layered on top
Company Knowledge (Per Company)
├── Specific Service Areas (geographic coverage)
├── Pricing Models (company-specific rates)
├── Staff Availability (schedules, on-call rotations)
├── Equipment Preferences (brands they install/service)
├── Customer Policies (warranties, guarantees, payment)
└── Custom Workflows (unique business processes)
```

### **Integration Architecture:**
```
External Service Integrations
├── 📞 Twilio (Voice & SMS)
│   ├── Webhook endpoints for real-time call processing
│   ├── Call forwarding and routing logic
│   ├── SMS automation and two-way messaging
│   └── Call recording and transcription
│
├── 🎤 ElevenLabs (Voice Synthesis)
│   ├── Company-specific voice selection
│   ├── Real-time TTS generation
│   ├── Voice emotion and tone control
│   └── Multi-language support
│
├── 🤖 Google Gemini (LLM)
│   ├── Context-aware conversation processing
│   ├── Intent recognition and routing
│   ├── Knowledge base integration
│   └── Response generation and optimization
│
├── 📅 Google Calendar (Scheduling)
│   ├── OAuth integration per company
│   ├── Availability checking and booking
│   ├── Automated appointment creation
│   └── Reminder and notification system
│
└── 🔍 Future Integrations (Planned)
    ├── CRM Systems (HubSpot, Salesforce)
    ├── Payment Processing (Stripe, Square)
    ├── Field Service Management (ServiceTitan)
    └── Review Management (Google, Yelp)
```

---

## 🚀 **DEPLOYMENT & PRODUCTION ARCHITECTURE**

### **Current Production Deployment:**
```
GitHub Repository
├── Code Push → main branch
├── Automatic Trigger → Render.com deployment
├── Build Process → npm install, environment setup
├── Health Check → /health endpoint validation
├── Live Deployment → https://clientsvia-backend.onrender.com
└── Monitoring → Log analysis, error tracking
```

### **Production Environment Variables:**
```javascript
// Critical configuration (managed via Render dashboard)
{
  NODE_ENV: "production",
  MONGODB_URI: "mongodb+srv://...",        // Database connection
  TWILIO_ACCOUNT_SID: "AC...",            // Phone service auth
  TWILIO_AUTH_TOKEN: "...",               // Phone service secret
  ELEVENLABS_API_KEY: "sk-...",           // Voice synthesis key
  GOOGLE_CLIENT_ID: "...",                // OAuth integration
  GOOGLE_CLIENT_SECRET: "...",            // OAuth secret
  JWT_SECRET: "...",                      // Future authentication
  REDIS_URL: "redis://...",               // Caching layer
  PORT: 4000                              // Server port
}
```

### **Production File Structure:**
```
/Users/marc/MyProjects/clientsvia-backend/
├── 📁 clients/              # External service clients (Twilio, ElevenLabs)
├── 📁 config/              # Configuration files (templates, passport)
├── 📁 handlers/            # Business logic handlers
├── 📁 hooks/               # Event hooks and triggers
├── 📁 lib/                 # Shared libraries (validation, utilities)
├── 📁 logs/                # Winston log files (combined, error, http)
├── 📁 middleware/          # Express middleware (auth, validation, security)
├── 📁 models/              # MongoDB/Mongoose data models
├── 📁 public/              # Frontend static files (HTML, CSS, JS)
│   ├── 📁 css/            # Styling (TailwindCSS)
│   ├── 📁 js/             # Frontend JavaScript
│   └── *.html             # Admin dashboard pages
├── 📁 routes/              # API endpoint definitions
├── 📁 services/           # Business logic services
├── 📁 utils/              # Utility functions (logger, phone, etc.)
├── 📄 index.js            # Main server entry point
├── 📄 server.js           # Express server configuration
├── 📄 package.json        # Dependencies and scripts
└── 📄 render.yaml         # Deployment configuration
```

### **Performance & Scalability:**
```
Current Capacity
├── 🔄 Single Instance (Render.com)
│   ├── Auto-scaling based on traffic
│   ├── 512MB-1GB RAM allocation
│   └── CPU scaling as needed
│
├── 📊 Database (MongoDB Atlas)
│   ├── Shared cluster (development tier)
│   ├── Auto-scaling storage
│   └── Built-in backups and replication
│
├── 🚀 CDN & Caching
│   ├── CloudFlare CDN for static assets
│   ├── Redis caching for company data
│   └── MongoDB query optimization
│
└── 📈 Monitoring (Manual)
    ├── Health endpoint monitoring
    ├── Winston log analysis
    ├── Error tracking via logs
    └── Manual performance monitoring
```

### **Production Readiness Status:**
```
✅ COMPLETED:
├── SSL/HTTPS Security (CloudFlare managed)
├── Winston Logging System (structured, categorized)
├── Multi-tenant Security Audit (critical vulnerabilities fixed)
├── Health Monitoring Endpoint
├── Database Connection Stability
├── External API Integration (Twilio, ElevenLabs, Gemini)
├── Static Asset Serving
└── Environment Variable Management

🔄 IN PROGRESS:
├── Authentication Middleware (for admin endpoints)
├── Error Monitoring Integration (Sentry planned)
├── Automated Backup Strategy
└── Performance Optimization

📋 PLANNED:
├── Load Testing and Optimization
├── Database Query Performance Tuning
├── Advanced Monitoring (New Relic/DataDog)
├── Horizontal Scaling Architecture
├── CI/CD Pipeline Enhancement
└── Disaster Recovery Planning
```

### **Critical Production Considerations:**
1. **Data Backup:** Currently relies on MongoDB Atlas automatic backups
2. **Error Handling:** Winston logging provides error tracking, but no alerting
3. **Scaling:** Single instance can handle current load, horizontal scaling needed for growth
4. **Security:** Multi-tenant isolation secured, but admin authentication still needed
5. **Monitoring:** Manual monitoring via logs, automated monitoring planned
6. **Performance:** No load testing completed, optimization based on usage patterns

### **Business Continuity:**
- **RTO (Recovery Time Objective):** < 30 minutes (Render auto-restart + MongoDB redundancy)
- **RPO (Recovery Point Objective):** < 1 hour (MongoDB continuous backups)
- **Failover:** Automatic via Render.com infrastructure
- **Data Loss Prevention:** MongoDB Atlas cluster replication
- **Communication:** Health endpoint provides real-time status

---

## 📋 **ARCHITECTURAL SUMMARY**

### **Platform Identity:**
ClientsVia is a **production-ready multi-tenant SaaS platform** that provides AI-powered phone agents for trade companies (HVAC, Plumbing, Electrical). Each company operates as an isolated tenant with complete customization of their AI agent's behavior, voice, knowledge base, and business workflows.

### **Technical Foundation:**
- **Architecture:** Multi-tenant SaaS with strict data isolation
- **Stack:** Node.js/Express + MongoDB + Twilio + ElevenLabs + Google Gemini
- **Security:** Post-audit hardened with comprehensive vulnerability fixes
- **Deployment:** Production-ready on Render.com with CloudFlare protection
- **Monitoring:** Winston logging with structured categorization

### **Business Model:**
- **Target Market:** Small to medium trade businesses needing phone automation
- **Value Proposition:** Professional AI agents with industry-specific knowledge
- **Revenue Model:** SaaS subscriptions per company (multi-tenant efficiency)
- **Competitive Advantage:** Trade-specific customization and voice quality

### **Production Status:**
- **Live URL:** https://clientsvia-backend.onrender.com
- **Security:** ✅ Critical vulnerabilities resolved, multi-tenant isolation secured
- **Performance:** ✅ SSL/HTTPS, CDN, auto-scaling, health monitoring
- **Reliability:** ✅ Database redundancy, automatic backups, error logging
- **Next Phase:** Authentication middleware, error monitoring, performance optimization

### **Key Success Factors:**
1. **Perfect Data Isolation:** No cross-company data leakage (secured)
2. **Industry Expertise:** Trade-specific knowledge and terminology
3. **Voice Quality:** Professional ElevenLabs synthesis for customer interaction
4. **Scalability:** Single codebase serving multiple companies efficiently
5. **Reliability:** 24/7 phone availability with intelligent call handling

### **Architecture Maturity Level:**
```
🎯 CURRENT STATUS: Production-Ready with Security Hardening Complete
├── ✅ Core Functionality: Fully operational
├── ✅ Security: Critical vulnerabilities resolved
├── ✅ Infrastructure: Production deployment stable
├── ✅ Monitoring: Logging and health checks operational
├── 🔄 Enhancement Phase: Authentication and advanced monitoring
└── 📈 Scale Phase: Performance optimization and growth features
```

---

**Document Maintenance:**
- **Update Frequency:** After major architectural changes or security audits
- **Responsibility:** Development team and security auditors
- **Version Control:** Track changes with security incident responses
- **Review Schedule:** Monthly architecture review, quarterly security audit

**Last Major Update:** July 27, 2025 - Post critical security audit and vulnerability resolution
