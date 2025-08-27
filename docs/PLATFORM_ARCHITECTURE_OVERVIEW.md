# ClientsVia Platform - Architecture & Multi-Tenant Data Strategy

**Last Updated**: December 2024  
**Purpose**: Comprehensive overview of platform architecture and data isolation strategy

---

## 🏗️ Platform Overview

### **What is ClientsVia?**
ClientsVia is a **multi-tenant AI Agent SaaS platform** that provides companies across different trade industries with intelligent phone-based AI agents. Each company operates as a completely isolated tenant with their own AI configuration, voice settings, phone numbers, and business logic.

### **Business Model**
```
ClientsVia Platform (Multi-Tenant SaaS)
├── Company A (HVAC Business - Florida)        [companyId: "68813026dd95f599c74e49c7"]
├── Company B (Plumbing Business - Texas)      [companyId: "def456789abc123456789def"]
├── Company C (Electrical Business - CA)      [companyId: "789abc123def456789abc123"]
└── [Each completely isolated with custom AI agents and data]
```

---

## 🎯 Multi-Tenant Architecture Principles

### **1. Complete Data Isolation** [[memory:7283147]]
Every piece of data is scoped by `companyId` to ensure zero cross-contamination:

```javascript
// FUNDAMENTAL PRINCIPLE: Everything is company-scoped
Database Structure:
├── Company A Data (companyId: "68813026dd95f599c74e49c7")
│   ├── AI Agent Logic Settings (aiAgentLogic field)
│   ├── Trade Categories (company-specific selection)
│   ├── Phone Configuration (Twilio numbers)
│   ├── Voice Synthesis Settings (ElevenLabs)
│   ├── Knowledge Base (company Q&A)
│   ├── Booking Flows (scheduling rules)
│   ├── Contact Management (customers, employees)
│   └── Analytics & Call Logs
├── Company B Data (companyId: "def456...")
│   ├── [Same structure, completely isolated]
│   └── [ZERO data crossover - CRITICAL for security]
└── Global Settings (Shared Templates)
    ├── Trade Category Definitions (HVAC, Plumbing, Electrical)
    ├── Platform Configuration
    └── Admin Controls
```

### **2. Two-Tier Data Strategy**

#### **Global Data (Shared Templates)**
- **Trade Category Definitions**: Master list of trade categories
- **Enterprise Templates**: Base templates for different industries
- **Platform Configuration**: System-wide settings
- **Default AI Models**: Available LLM options

#### **Company-Specific Data** [[memory:7283147]]
- **AI Agent Logic**: Custom thresholds, memory settings, priority flows
- **Trade Category Selection**: Which global categories this company uses
- **Knowledge Base**: Company-specific Q&A pairs
- **Personality Settings**: Custom voice tone, response style
- **Booking Flows**: Company-specific scheduling rules

---

## 💾 Database Schema Architecture

### **Company Model Structure**
```javascript
// models/Company.js - Main company document
{
  _id: ObjectId("68813026dd95f599c74e49c7"),  // Primary company identifier
  companyName: "ABC HVAC Services",
  phone: "+1234567890",
  
  // Global trade categories this company uses
  tradeCategories: ["HVAC Residential", "HVAC Commercial"],
  
  // AI Agent Logic Configuration (Company-Specific)
  aiAgentLogic: {
    // Knowledge source confidence thresholds
    thresholds: {
      companyQnA: 0.8,      // Company-specific Q&A threshold
      tradeQnA: 0.75,       // Trade category Q&A threshold
      vectorSearch: 0.7,     // Vector search threshold
      llmFallback: 0.6      // LLM fallback threshold
    },
    
    // Memory & Intelligence Settings
    memorySettings: {
      memoryMode: "conversational",  // short, conversational, persistent
      contextRetention: 30           // minutes
    },
    
    // Fallback Behavior Configuration
    fallbackBehavior: {
      rejectLowConfidence: true,
      escalateOnNoMatch: true,
      message: "Let me connect you with a specialist..."
    },
    
    // Knowledge Source Priority Order
    knowledgeSourcePriorities: [
      { source: "companyKB", priority: 1, isActive: true },
      { source: "tradeQA", priority: 2, isActive: true },
      { source: "templates", priority: 3, isActive: true },
      { source: "llmFallback", priority: 4, isActive: true }
    ],
    
    lastUpdated: Date
  },
  
  // Other company-specific settings
  agentIntelligenceSettings: { ... },
  personalitySettings: { ... },
  bookingFlows: { ... }
}
```

### **Global Collections (Shared)**
```javascript
// Enterprise Trade Categories (Global)
db.enterpriseTradeCategories.find()
[
  { name: "HVAC Residential", description: "...", keywords: [...] },
  { name: "Plumbing Residential", description: "...", keywords: [...] },
  { name: "Electrical Commercial", description: "...", keywords: [...] }
]

// Global Templates (Shared)
db.templates.find()
[
  { category: "greeting", type: "HVAC", template: "Thank you for calling..." },
  { category: "hold", type: "Plumbing", template: "Please hold while..." }
]
```

---

## 🚀 AI Agent Logic Data Retrieval Strategy

### **Mongoose + Redis Caching Architecture** [[memory:7289715]]

The AI Agent Logic system uses a sophisticated **two-tier caching strategy** for optimal performance:

#### **1. Primary Data Flow**
```javascript
// AI Agent Logic Data Retrieval Flow
Request for Company Settings
    ↓
1. Check Redis Cache First
    ├── Cache Hit: Return cached data (sub-50ms response)
    └── Cache Miss: Query MongoDB
        ↓
2. MongoDB Query (Company-Scoped)
    ├── Query: Company.findById(companyId).select('aiAgentLogic')
    ├── Result: Company-specific AI settings
    └── Cache in Redis (TTL: 5 minutes)
        ↓
3. Return to AI Agent Logic Tab
```

#### **2. Caching Implementation**
```javascript
// Redis Cache Keys (Company-Scoped)
const cacheKeys = {
  company: `company:${companyId}`,                    // Complete company data
  aiSettings: `ai-settings:company:${companyId}`,     // AI Agent Logic settings
  knowledge: `knowledge:company:${companyId}:*`,      // Company knowledge base
  personality: `personality:company:${companyId}`,    // Personality settings
  tradeCategories: `trade:${companyId}`               // Selected trade categories
};

// Cache Implementation in Routes
router.get('/admin/:companyID/ai-settings', async (req, res) => {
  const { companyID } = req.params;
  const cacheKey = `ai-settings:company:${companyID}`;
  
  // 1. Try Redis cache first
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    console.log(`🚀 CACHE HIT: ${cacheKey}`);
    return res.json(JSON.parse(cached));
  }
  
  // 2. Query MongoDB with company isolation
  const company = await Company.findById(companyID)
    .select('aiAgentLogic tradeCategories')
    .lean();
  
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }
  
  // 3. Cache result with TTL
  await redisClient.setex(cacheKey, 300, JSON.stringify(company.aiAgentLogic));
  
  return res.json(company.aiAgentLogic);
});
```

#### **3. Cache Invalidation Strategy**
```javascript
// Cache Invalidation on Save
router.post('/companies/:id/agent-settings', async (req, res) => {
  const companyId = req.params.id;
  
  // 1. Save to MongoDB
  const company = await Company.findByIdAndUpdate(companyId, {
    aiAgentLogic: updatedSettings,
    updatedAt: new Date()
  });
  
  // 2. CRITICAL: Clear Redis cache to ensure fresh data
  const cacheKey = `company:${companyId}`;
  await redisClient.del(cacheKey);
  console.log(`🗑️ CACHE CLEARED: ${cacheKey}`);
  
  // 3. Clear related caches
  await redisClient.del(`ai-settings:company:${companyId}`);
  await redisClient.del(`knowledge:company:${companyId}:*`);
  
  res.json({ success: true });
});
```

---

## 🔄 AI Agent Logic Integration Points

### **1. Frontend → Backend Data Flow**
```javascript
// Frontend Save Process
async function saveAIAgentLogicSettings() {
  const companyId = getCurrentCompanyId();  // Company isolation
  
  // Collect company-specific settings
  const settings = {
    tradeCategories: getSelectedTradeCategories(),    // From global list
    aiAgentLogic: {
      thresholds: getThresholdSettings(),             // Company-specific
      memorySettings: getMemorySettings(),            // Company-specific
      fallbackBehavior: getFallbackSettings()        // Company-specific
    }
  };
  
  // Save with company scoping
  const response = await fetch(`/api/company/companies/${companyId}/agent-settings`, {
    method: 'POST',
    body: JSON.stringify(settings)
  });
}
```

### **2. Backend Data Processing**
```javascript
// Backend Save Handler
router.post('/companies/:id/agent-settings', async (req, res) => {
  const companyId = req.params.id;  // Company isolation enforced
  const { tradeCategories, aiAgentLogic } = req.body;
  
  // 1. Validate trade categories against global list
  const validCategories = await db.collection('enterpriseTradeCategories')
    .find({ name: { $in: tradeCategories } })
    .toArray();
  
  // 2. Save company-specific settings
  const company = await Company.findByIdAndUpdate(companyId, {
    tradeCategories: validCategories.map(cat => cat.name),
    aiAgentLogic: {
      ...aiAgentLogic,
      lastUpdated: new Date()
    }
  });
  
  // 3. Clear cache for fresh data
  await redisClient.del(`company:${companyId}`);
  
  res.json({ success: true, company });
});
```

### **3. AI Agent Runtime Integration**
```javascript
// AI Agent uses company-specific settings during calls
class AIAgentRuntime {
  async processCall(companyId, callData) {
    // 1. Load company-specific AI settings (cached)
    const aiSettings = await this.getCompanyAISettings(companyId);
    
    // 2. Apply company-specific thresholds
    const response = await this.processWithThresholds(
      callData.speech,
      aiSettings.thresholds,
      companyId
    );
    
    // 3. Use company-specific memory settings
    await this.storeConversationContext(
      companyId,
      callData,
      aiSettings.memorySettings
    );
    
    return response;
  }
  
  async getCompanyAISettings(companyId) {
    // Redis cache first, MongoDB fallback
    const cacheKey = `ai-settings:company:${companyId}`;
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    const company = await Company.findById(companyId)
      .select('aiAgentLogic')
      .lean();
    
    await redisClient.setex(cacheKey, 300, JSON.stringify(company.aiAgentLogic));
    return company.aiAgentLogic;
  }
}
```

---

## 🔐 Security & Multi-Tenant Isolation

### **Critical Security Principles** [[memory:7283147]]
1. **Every endpoint MUST validate companyId for tenant isolation**
2. **Models with companyId fields MUST filter by companyId in queries**
3. **No aggregate data endpoints without authentication**
4. **All admin functions require proper authentication middleware**

### **Implementation Example**
```javascript
// Secure endpoint with company isolation
router.get('/admin/:companyID/ai-settings', authenticateSingleSession, async (req, res) => {
  const { companyID } = req.params;
  
  // 1. Verify user has access to this company
  if (req.user.companyId.toString() !== companyID) {
    return res.status(403).json({ error: 'Access denied - company isolation' });
  }
  
  // 2. Query with company scoping
  const company = await Company.findById(companyID);  // Only this company's data
  
  // 3. Return company-specific data only
  res.json({
    companyID,
    aiAgentLogic: company.aiAgentLogic,
    tradeCategories: company.tradeCategories
  });
});
```

---

## ⚡ Performance Optimization Strategy

### **1. Redis Caching Layers** [[memory:7289715]]
```javascript
// Multi-layer caching strategy
const cachingStrategy = {
  // Level 1: Company data (5 minutes TTL)
  company: {
    key: `company:${companyId}`,
    ttl: 300,
    scope: 'complete company document'
  },
  
  // Level 2: AI settings (5 minutes TTL)
  aiSettings: {
    key: `ai-settings:company:${companyId}`,
    ttl: 300,
    scope: 'aiAgentLogic field only'
  },
  
  // Level 3: Knowledge base (1 hour TTL)
  knowledge: {
    key: `knowledge:company:${companyId}:${queryHash}`,
    ttl: 3600,
    scope: 'specific knowledge queries'
  },
  
  // Level 4: Personality responses (1 hour TTL)
  personality: {
    key: `personality:company:${companyId}:${category}`,
    ttl: 3600,
    scope: 'personality response categories'
  }
};
```

### **2. Database Query Optimization**
```javascript
// Optimized MongoDB queries
const optimizedQueries = {
  // Use lean() for read-only operations
  loadAISettings: () => Company.findById(companyId)
    .select('aiAgentLogic tradeCategories')
    .lean(),
  
  // Use specific field updates for saves
  saveAISettings: (updates) => Company.findByIdAndUpdate(companyId, {
    $set: {
      'aiAgentLogic.thresholds': updates.thresholds,
      'aiAgentLogic.lastUpdated': new Date()
    }
  }),
  
  // Index on companyId for fast lookups
  indexes: [
    { companyId: 1 },
    { 'aiAgentLogic.lastUpdated': -1 },
    { tradeCategories: 1 }
  ]
};
```

---

## 🎯 Key Takeaways

### **Platform Type**
- **Multi-Tenant SaaS**: Complete isolation between companies
- **Industry-Specific**: Tailored for trade service companies
- **AI-Powered**: Intelligent phone agents with custom configurations

### **Data Architecture**
- **Global + Company-Specific**: Two-tier data strategy
- **MongoDB + Redis**: Primary storage with performance caching
- **Company Isolation**: Every operation scoped by companyId [[memory:7283147]]

### **AI Agent Logic Role**
- **Configuration Hub**: Central control for AI behavior per company
- **Performance Optimized**: Sub-50ms response with Redis caching [[memory:7289715]]
- **Multi-Tenant Safe**: Complete data isolation and security

### **Scalability**
- **Horizontal Scaling**: Each company isolated for independent scaling
- **Performance Caching**: Multiple cache layers for optimal response times
- **Resource Optimization**: Efficient MongoDB queries with Redis acceleration

---

*This architecture overview reflects the current production system as of December 2024. The platform successfully serves multiple companies with complete data isolation and enterprise-grade performance.*
