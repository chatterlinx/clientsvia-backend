# Architecture Documentation - ClientsVia AI Platform

## 🏗️ System Architecture Overview

ClientsVia is an enterprise-grade, multi-tenant AI agent platform designed specifically for voice-first service companies. The architecture follows a layered, microservices-inspired approach with strong separation of concerns and enterprise security.

## 🎯 Architectural Principles

### Core Design Principles
1. **Multi-Tenancy**: Complete isolation between client companies
2. **Security-First**: Enterprise-grade security at every layer
3. **Scalability**: Horizontal scaling capabilities
4. **Modularity**: Loosely coupled, replaceable components
5. **Observability**: Comprehensive monitoring and logging
6. **Performance**: Sub-second response times
7. **Reliability**: 99.9% uptime target

### Architecture Patterns
- **Layered Architecture**: Clear separation of presentation, business, and data layers
- **Service-Oriented**: Modular services with well-defined interfaces
- **Event-Driven**: Asynchronous processing where appropriate
- **Repository Pattern**: Abstracted data access layer
- **Middleware Pattern**: Composable request processing pipeline

## 🏛️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Web Browser   │  │  Mobile Apps    │  │   API Clients   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTPS/WSS
┌─────────────────────┴───────────────────────────────────────────┐
│                      Gateway Layer                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Load Balancer │  │  API Gateway    │  │   Rate Limiter  │ │
│  │   (Nginx/HAProxy)│  │   (Express)     │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│                   Security Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Authentication  │  │  Authorization  │  │  Session Mgmt   │ │
│  │   (JWT/OAuth)   │  │   (RBAC)       │  │  (Redis Store)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   GeoIP Check   │  │ Hardware ID Lock│  │ Single Session  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│                Application Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   API Routes    │  │   Controllers   │  │   Middleware    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│                 Business Logic Layer                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ AI Intelligence │  │Template Engine  │  │ Agent Service   │ │
│  │    Engine       │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │Knowledge Base   │  │ Booking Engine  │  │Workflow Service │ │
│  │   Service       │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│                   Data Layer                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │    MongoDB      │  │     Redis       │  │    Pinecone     │ │
│  │ (Primary DB)    │  │ (Cache/Session) │  │ (Vector Search) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Component Architecture

### 1. API Gateway & Routing

#### Express.js Application Structure
```javascript
// app.js - Main application orchestrator
class Application {
  constructor() {
    this.express = express();
    this.middleware = new MiddlewareStack();
    this.routes = new RouteManager();
    this.services = new ServiceContainer();
  }
  
  async initialize() {
    await this.setupMiddleware();
    await this.setupRoutes();
    await this.setupServices();
    await this.setupErrorHandling();
  }
}
```

#### Route Architecture
```
routes/
├── auth.js              # Authentication endpoints
├── aiAgentLogic.js      # AI agent configuration
├── company.js           # Company management
├── booking.js           # Booking system
├── monitoring.js        # System monitoring
├── admin.js             # Administrative functions
└── api/
    ├── v1/              # API versioning
    └── webhook/         # Webhook handlers
```

### 2. Security Architecture

#### Multi-Layer Security Stack
```javascript
// Security middleware pipeline
const securityStack = [
  helmet(),                    // Security headers
  rateLimit(),                 // Rate limiting
  cors(corsOptions),           // CORS protection
  geoIPSecurityService,        // Geographic validation
  hardwareIDSecurityService,   // Device verification
  authMiddleware,              // JWT authentication
  singleSessionManager,        # Session conflict prevention
  auditMiddleware             // Activity logging
];
```

#### Session Management Architecture
```javascript
class SessionManager {
  constructor() {
    this.store = new RedisSessionStore();
    this.security = new SecurityValidator();
    this.monitor = new SessionMonitor();
  }
  
  async validateSession(userId, deviceId, hardwareId) {
    // Multi-factor session validation
    await this.security.validateDevice(userId, hardwareId);
    await this.security.validateGeoLocation(userId, req.ip);
    await this.checkSessionConflict(userId, deviceId);
    return this.createSecureSession(userId, deviceId);
  }
}
```

### 3. AI Intelligence Architecture

#### Core AI Engine Structure
```
services/ai/
├── clientsViaIntelligenceEngine.js    # Company-specific AI logic
├── templateIntelligenceEngine.js      # Response template optimization
├── agentPersonalityEngine.js          # Personality customization
├── knowledgeBaseService.js            # Knowledge management
├── learningEngine.js                  # Continuous learning
└── responseOptimizer.js               # Response quality optimization
```

#### Intelligence Engine Flow
```javascript
class IntelligenceOrchestrator {
  async processQuery(companyId, query, context) {
    // 1. Company context loading
    const companyConfig = await this.loadCompanyConfig(companyId);
    
    // 2. Intent analysis
    const intent = await this.analyzeIntent(query, context);
    
    // 3. Knowledge base search
    const knowledge = await this.searchKnowledgeBase(companyId, query);
    
    // 4. Template intelligence
    const template = await this.selectOptimalTemplate(companyId, intent);
    
    // 5. Response generation
    const response = await this.generateResponse({
      company: companyConfig,
      intent,
      knowledge,
      template,
      context
    });
    
    // 6. Quality optimization
    return await this.optimizeResponse(response, context);
  }
}
```

### 4. Data Architecture

#### Database Design Patterns

##### MongoDB Collections Structure
```javascript
// Multi-tenant data isolation
const companySchema = {
  _id: ObjectId,
  name: String,
  industry: String,
  settings: {
    aiConfig: {},
    personality: {},
    businessRules: {}
  },
  createdAt: Date,
  updatedAt: Date
};

const knowledgeEntrySchema = {
  _id: ObjectId,
  companyId: ObjectId,        // Tenant isolation
  question: String,
  answer: String,
  category: String,
  tags: [String],
  confidence: Number,
  usage: {
    accessCount: Number,
    lastAccessed: Date,
    successRate: Number
  },
  createdAt: Date,
  updatedAt: Date
};
```

##### Redis Data Structures
```javascript
// Session storage pattern
const sessionKey = `session:${userId}:${deviceId}`;
const sessionData = {
  userId,
  deviceId,
  hardwareId,
  location: geoData,
  loginTime: timestamp,
  lastActivity: timestamp,
  permissions: []
};

// Cache patterns
const cachePatterns = {
  company: `company:${companyId}`,
  knowledge: `kb:${companyId}:${hash}`,
  template: `template:${companyId}:${intentId}`,
  response: `response:${queryHash}:${ttl}`
};
```

### 5. Service Layer Architecture

#### Service Container Pattern
```javascript
class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.dependencies = new Map();
  }
  
  register(name, serviceClass, dependencies = []) {
    this.services.set(name, {
      class: serviceClass,
      instance: null,
      dependencies
    });
  }
  
  async get(name) {
    const service = this.services.get(name);
    if (!service.instance) {
      service.instance = await this.createInstance(service);
    }
    return service.instance;
  }
}
```

#### Service Architecture
```
services/
├── core/
│   ├── agentService.js           # Main agent orchestration
│   ├── companyService.js         # Company management
│   └── userService.js            # User management
├── ai/
│   ├── intelligenceEngine.js    # AI reasoning engine
│   ├── templateEngine.js        # Template management
│   └── learningEngine.js        # Machine learning
├── business/
│   ├── bookingService.js        # Booking logic
│   ├── workflowService.js       # Workflow automation
│   └── notificationService.js   # Notifications
└── infrastructure/
    ├── cacheService.js          # Caching abstraction
    ├── queueService.js          # Message queuing
    └── monitoringService.js     # System monitoring
```

## 🔄 Data Flow Architecture

### Request Processing Flow

```
1. Client Request
   ↓
2. Load Balancer (Nginx)
   ↓
3. Rate Limiting & Security Headers
   ↓
4. CORS Validation
   ↓
5. GeoIP & Location Validation
   ↓
6. Device & Hardware Validation
   ↓
7. JWT Authentication
   ↓
8. Session Conflict Check
   ↓
9. Route Handler
   ↓
10. Business Service
    ↓
11. AI Engine (if applicable)
    ↓
12. Database Operations
    ↓
13. Response Generation
    ↓
14. Audit Logging
    ↓
15. Client Response
```

### AI Processing Pipeline

```
User Query
    ↓
Company Context Loading
    ↓
Intent Analysis
    ↓
Knowledge Base Search ──→ Vector Database (Pinecone)
    ↓
Template Selection ──→ Template Intelligence Engine
    ↓
Response Generation ──→ External AI APIs (OpenAI)
    ↓
Quality Optimization
    ↓
Personalization ──→ Company Personality Engine
    ↓
Learning & Adaptation ──→ Feedback Loop
    ↓
Final Response
```

## 🔐 Security Architecture

### Authentication Flow
```
1. User Login Request
   ↓
2. Credential Validation
   ↓
3. Device Fingerprinting
   ↓
4. GeoIP Validation
   ↓
5. Session Conflict Check
   ↓
6. Hardware ID Verification
   ↓
7. JWT Token Generation
   ↓
8. Session Creation (Redis)
   ↓
9. Audit Log Entry
   ↓
10. Response with Token
```

### Session Security Model
```javascript
class SessionSecurityModel {
  // Single session enforcement
  async enforceUniqueSession(userId, newDeviceId) {
    const existingSessions = await this.getActiveSessions(userId);
    
    if (existingSessions.length > 0) {
      await this.terminateAllSessions(userId);
      await this.auditLog.logSessionConflict(userId, newDeviceId);
    }
    
    return this.createNewSession(userId, newDeviceId);
  }
  
  // Hardware binding
  async validateDeviceBinding(userId, hardwareId) {
    const registeredDevice = await this.getRegisteredDevice(userId);
    
    if (!registeredDevice) {
      // Auto-approve for single-user environment
      return await this.registerDevice(userId, hardwareId);
    }
    
    return registeredDevice.hardwareId === hardwareId;
  }
}
```

## 📊 Performance Architecture

### Caching Strategy
```javascript
// Multi-layer caching architecture
class CacheArchitecture {
  constructor() {
    this.l1Cache = new MemoryCache();      // In-memory (fastest)
    this.l2Cache = new RedisCache();       // Redis (shared)
    this.l3Cache = new DatabaseCache();    // DB query cache
  }
  
  async get(key) {
    // L1 Cache check
    let value = await this.l1Cache.get(key);
    if (value) return value;
    
    // L2 Cache check
    value = await this.l2Cache.get(key);
    if (value) {
      await this.l1Cache.set(key, value, 300); // 5 min
      return value;
    }
    
    // L3 Cache or database
    value = await this.l3Cache.get(key);
    if (value) {
      await this.l2Cache.set(key, value, 3600); // 1 hour
      await this.l1Cache.set(key, value, 300);   // 5 min
    }
    
    return value;
  }
}
```

### Database Optimization
```javascript
// Index strategy for performance
const performanceIndexes = {
  // Company-based queries (multi-tenancy)
  companies: [
    { companyId: 1, status: 1 },
    { companyId: 1, createdAt: -1 }
  ],
  
  // Knowledge base search
  knowledgeEntries: [
    { companyId: 1, category: 1 },
    { companyId: 1, tags: 1 },
    { question: 'text', answer: 'text', tags: 'text' }
  ],
  
  // Session management
  sessions: [
    { userId: 1, deviceId: 1 },
    { expiresAt: 1 },
    { hardwareId: 1 }
  ],
  
  // Audit logs
  auditLogs: [
    { userId: 1, timestamp: -1 },
    { action: 1, timestamp: -1 },
    { timestamp: -1 }
  ]
};
```

## 🔄 Event-Driven Architecture

### Event Flow System
```javascript
class EventArchitecture {
  constructor() {
    this.eventBus = new EventEmitter();
    this.eventStore = new EventStore();
    this.eventHandlers = new Map();
  }
  
  // Event publishing
  async publishEvent(eventType, payload) {
    const event = {
      id: uuidv4(),
      type: eventType,
      payload,
      timestamp: new Date(),
      metadata: {}
    };
    
    await this.eventStore.save(event);
    this.eventBus.emit(eventType, event);
    
    return event;
  }
  
  // Event subscription
  subscribe(eventType, handler) {
    this.eventBus.on(eventType, handler);
    
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);
  }
}
```

## 🏗️ Deployment Architecture

### Container Architecture
```dockerfile
# Multi-stage build for optimization
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && \
    adduser -S clientsvia -u 1001
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chown -R clientsvia:nodejs /app
USER clientsvia
EXPOSE 3000
CMD ["node", "server.js"]
```

### Microservices Decomposition (Future)
```
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┼───────────────────────────────────────────┐
│  ┌─────────────────┐│┌─────────────────┐ ┌─────────────────┐    │
│  │  Auth Service   │││ Company Service │ │  AI Service     │    │
│  │                 │││                 │ │                 │    │
│  └─────────────────┘│└─────────────────┘ └─────────────────┘    │
│  ┌─────────────────┐│┌─────────────────┐ ┌─────────────────┐    │
│  │Booking Service  │││Knowledge Service│ │Analytics Service│    │
│  │                 │││                 │ │                 │    │
│  └─────────────────┘│└─────────────────┘ └─────────────────┘    │
└─────────────────────┼───────────────────────────────────────────┘
                      │
┌─────────────────────┼───────────────────────────────────────────┐
│                  Shared Data Layer                              │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │    MongoDB      │ │     Redis       │ │   Message Queue │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 📈 Scalability Architecture

### Horizontal Scaling Strategy
```javascript
// Load balancing configuration
const clusterConfig = {
  instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
  exec_mode: 'cluster',
  
  // Resource management
  max_memory_restart: '1G',
  min_uptime: '10s',
  max_restarts: 10,
  
  // Health monitoring
  health_check_interval: 30000,
  
  // Load distribution
  load_balancing: 'round_robin'
};
```

### Database Scaling
```javascript
// MongoDB replica set configuration
const mongoConfig = {
  replicaSet: 'clientsvia-replica',
  readPreference: 'secondaryPreferred',
  writeConcern: {
    w: 'majority',
    j: true,
    wtimeout: 5000
  },
  
  // Sharding strategy (future)
  shardKey: { companyId: 1 },
  zones: [
    { name: 'us-east', range: { companyId: MinKey, companyId: 'company-5000' }},
    { name: 'us-west', range: { companyId: 'company-5001', companyId: MaxKey }}
  ]
};
```

## 🔍 Monitoring Architecture

### Observability Stack
```javascript
class ObservabilityArchitecture {
  constructor() {
    this.metrics = new MetricsCollector();
    this.logs = new LogAggregator();
    this.traces = new DistributedTracing();
    this.alerts = new AlertManager();
  }
  
  // Application metrics
  collectMetrics() {
    return {
      performance: this.metrics.getPerformanceMetrics(),
      business: this.metrics.getBusinessMetrics(),
      security: this.metrics.getSecurityMetrics(),
      infrastructure: this.metrics.getInfrastructureMetrics()
    };
  }
  
  // Distributed tracing
  traceRequest(req, res, next) {
    const trace = this.traces.startTrace({
      operation: `${req.method} ${req.path}`,
      userId: req.user?.id,
      companyId: req.company?.id
    });
    
    req.trace = trace;
    
    res.on('finish', () => {
      trace.finish({
        statusCode: res.statusCode,
        duration: Date.now() - trace.startTime
      });
    });
    
    next();
  }
}
```

## 🧪 Testing Architecture

### Testing Strategy
```javascript
// Testing pyramid implementation
const testingArchitecture = {
  // Unit tests (70%)
  unit: {
    services: 'tests/unit/services/',
    middleware: 'tests/unit/middleware/',
    utils: 'tests/unit/utils/'
  },
  
  // Integration tests (20%)
  integration: {
    api: 'tests/integration/api/',
    database: 'tests/integration/database/',
    external: 'tests/integration/external/'
  },
  
  // End-to-end tests (10%)
  e2e: {
    userFlows: 'tests/e2e/flows/',
    performance: 'tests/e2e/performance/',
    security: 'tests/e2e/security/'
  }
};
```

## 📋 Architecture Decision Records

### ADR-001: Database Choice
**Decision**: MongoDB as primary database
**Reasoning**: Document-based structure fits AI/ML data patterns, excellent scaling, strong community support
**Alternatives**: PostgreSQL, CouchDB
**Status**: Accepted

### ADR-002: Session Management
**Decision**: Redis-based session store with single-session enforcement
**Reasoning**: Performance, persistence, scalability requirements
**Alternatives**: In-memory, database sessions
**Status**: Accepted

### ADR-003: AI Architecture
**Decision**: Hybrid approach using external APIs with local intelligence layer
**Reasoning**: Best of both worlds - cutting-edge AI with custom business logic
**Alternatives**: Fully local AI, purely external APIs
**Status**: Accepted

---

This architecture provides enterprise-grade scalability, security, and maintainability while supporting the complex AI and multi-tenant requirements of the ClientsVia platform.
