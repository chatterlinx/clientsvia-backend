# Developer Guide - ClientsVia AI Platform

## 🛠️ Development Environment Setup

### Prerequisites
- **Node.js**: 18.0.0 or higher
- **MongoDB**: 6.0 or higher
- **Redis**: 7.0 or higher
- **Git**: Latest version
- **Code Editor**: VS Code recommended

### Local Development Setup

#### 1. Clone Repository
```bash
git clone https://github.com/clientsvia/platform.git
cd clientsvia-backend
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Environment Configuration
```bash
cp .env.example .env
```

#### 4. Configure Environment Variables
```env
# Development Environment
NODE_ENV=development
PORT=3000

# Database
MONGODB_URI=mongodb://localhost:27017/clientsvia-dev

# Security
JWT_SECRET=your-development-jwt-secret
EMERGENCY_BYPASS_KEY=emergency-dev-key-123

# Redis
REDIS_URL=redis://localhost:6379

# Security Features
HARDWARE_LOCK_ENABLED=false  # Disable for dev
GEOIP_ENABLED=false         # Disable for dev
ALLOWED_COUNTRIES=US,CA,GB,AU,DE,FR
```

#### 5. Start Services
```bash
# Start MongoDB (if local)
mongod

# Start Redis (if local)
redis-server

# Start application
npm start
```

#### 6. Verify Installation
Navigate to `http://localhost:3000/health` - should return:
```json
{
  "status": "healthy",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

## 🏗️ Architecture Deep Dive

### Project Structure
```
clientsvia-backend/
├── app.js                 # Express app configuration
├── server.js              # HTTP server entry point
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables
├── routes/                # API route handlers
│   ├── auth.js            # Authentication routes
│   ├── aiAgentLogic.js    # AI agent configuration
│   ├── company.js         # Company management
│   ├── booking.js         # Booking system
│   └── monitoring.js      # System monitoring
├── services/              # Business logic layer
│   ├── clientsViaIntelligenceEngine.js
│   ├── templateIntelligenceEngine.js
│   ├── agent.js           # Main agent service
│   ├── knowledgeBaseService.js
│   └── bookingFlowEngine.js
├── middleware/            # Express middleware
│   ├── auth.js            # JWT authentication
│   ├── singleSessionManager.js
│   ├── geoIPSecurityService.js
│   ├── hardwareIDSecurityService.js
│   └── rateLimit.js
├── models/                # Database models
│   ├── Company.js
│   ├── User.js
│   ├── KnowledgeEntry.js
│   └── Booking.js
├── public/                # Static frontend files
│   ├── ai-agent-logic.html
│   ├── login.html
│   └── css/
└── docs/                  # Documentation
```

### Key Services

#### 1. ClientsVia Intelligence Engine
**Location**: `/services/clientsViaIntelligenceEngine.js`

Core AI reasoning engine for company-specific intelligence:

```javascript
class ClientsViaIntelligenceEngine {
  async generateResponse(params) {
    const { company, conversation, businessRules } = params;
    
    // Apply company-specific logic
    const contextualResponse = await this.applyCompanyContext(
      company, 
      conversation
    );
    
    // Enhance with business rules
    const enhancedResponse = await this.applyBusinessRules(
      contextualResponse, 
      businessRules
    );
    
    return enhancedResponse;
  }
}
```

**Key Features**:
- Company-specific AI tuning
- Dynamic response generation
- Business rule application
- Learning and adaptation

#### 2. Template Intelligence Engine
**Location**: `/services/templateIntelligenceEngine.js`

Manages intelligent response templates:

```javascript
class TemplateIntelligenceEngine {
  async processQuery(params) {
    const { companyId, userQuery, context } = params;
    
    // Find best matching template
    const template = await this.findBestTemplate(
      companyId, 
      userQuery, 
      context
    );
    
    // Personalize response
    const personalizedResponse = await this.personalizeTemplate(
      template, 
      context
    );
    
    return personalizedResponse;
  }
}
```

**Key Features**:
- Template matching algorithm
- Response personalization
- Template optimization
- Performance analytics

#### 3. Agent Service
**Location**: `/services/agent.js`

Main agent orchestration service:

```javascript
class AgentService {
  async processUserQuery(companyId, query, context) {
    // Get company configuration
    const config = await this.getCompanyConfig(companyId);
    
    // Process through intelligence engines
    const intelligenceResponse = await this.intelligenceEngine
      .generateResponse({ company: config.company, query, context });
    
    const templateResponse = await this.templateEngine
      .processQuery({ companyId, userQuery: query, context });
    
    // Combine and optimize
    return this.combineResponses(
      intelligenceResponse, 
      templateResponse, 
      config
    );
  }
}
```

### Security Architecture

#### Single Session Manager
**Location**: `/middleware/singleSessionManager.js`

```javascript
class SingleSessionManager {
  async validateSession(userId, deviceId) {
    const existingSession = await this.redis.get(`session:${userId}`);
    
    if (existingSession && existingSession.deviceId !== deviceId) {
      // Session conflict detected
      await this.terminateAllSessions(userId);
      throw new Error('SESSION_CONFLICT');
    }
    
    return true;
  }
}
```

#### Hardware ID Security
**Location**: `/middleware/hardwareIDSecurityService.js`

```javascript
class HardwareIDSecurityService {
  async validateDevice(userId, hardwareId) {
    const registeredDevice = await this.getRegisteredDevice(userId);
    
    if (!registeredDevice) {
      // Auto-approve for single-user environment
      await this.registerDevice(userId, hardwareId);
      return true;
    }
    
    return registeredDevice.hardwareId === hardwareId;
  }
}
```

## 💻 Development Workflows

### 1. Adding New Features

#### Step 1: Create Feature Branch
```bash
git checkout -b feature/new-ai-capability
```

#### Step 2: Implement Service Logic
```javascript
// services/newFeatureService.js
class NewFeatureService {
  constructor() {
    this.initialized = false;
  }
  
  async initialize() {
    // Setup logic
    this.initialized = true;
  }
  
  async processRequest(params) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Feature logic here
    return result;
  }
}

module.exports = new NewFeatureService();
```

#### Step 3: Add Route Handler
```javascript
// routes/newFeature.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const newFeatureService = require('../services/newFeatureService');

router.post('/process', authenticateToken, async (req, res) => {
  try {
    const result = await newFeatureService.processRequest(req.body);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
```

#### Step 4: Register Route in App
```javascript
// app.js
const newFeatureRoutes = require('./routes/newFeature');
app.use('/api/new-feature', newFeatureRoutes);
```

#### Step 5: Add Tests
```javascript
// tests/newFeature.test.js
const request = require('supertest');
const app = require('../app');

describe('New Feature API', () => {
  test('should process request successfully', async () => {
    const response = await request(app)
      .post('/api/new-feature/process')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ data: 'test' });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

### 2. Database Operations

#### Adding New Model
```javascript
// models/NewModel.js
const mongoose = require('mongoose');

const newModelSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
newModelSchema.index({ companyId: 1, name: 1 });
newModelSchema.index({ createdAt: -1 });

// Middleware for updatedAt
newModelSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('NewModel', newModelSchema);
```

#### Database Queries
```javascript
// Efficient company-specific queries
const items = await NewModel.find({
  companyId: companyId,
  status: 'active'
})
.sort({ createdAt: -1 })
.limit(50)
.lean(); // Use lean() for read-only operations

// Aggregation for analytics
const analytics = await NewModel.aggregate([
  { $match: { companyId: mongoose.Types.ObjectId(companyId) } },
  {
    $group: {
      _id: '$category',
      count: { $sum: 1 },
      avgScore: { $avg: '$score' }
    }
  },
  { $sort: { count: -1 } }
]);
```

### 3. AI Integration Patterns

#### Adding New AI Service
```javascript
// services/newAIService.js
const OpenAI = require('openai');

class NewAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  
  async processWithAI(prompt, context = {}) {
    try {
      const systemPrompt = this.buildSystemPrompt(context);
      
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      return {
        success: true,
        response: response.choices[0].message.content,
        usage: response.usage
      };
    } catch (error) {
      console.error('AI Service Error:', error);
      throw new Error('AI_PROCESSING_FAILED');
    }
  }
  
  buildSystemPrompt(context) {
    return `You are an AI assistant for ${context.companyName}. 
            Industry: ${context.industry}
            Tone: ${context.personality?.tone || 'professional'}
            Always provide helpful, accurate responses.`;
  }
}

module.exports = new NewAIService();
```

### 4. Frontend Integration

#### Adding New UI Component
```html
<!-- public/new-feature.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Feature - ClientsVia</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div id="app" class="container mx-auto p-6">
        <h1 class="text-3xl font-bold mb-6">New Feature</h1>
        
        <div class="bg-white rounded-lg shadow-md p-6">
            <form id="newFeatureForm">
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">Input:</label>
                    <input type="text" id="inputField" 
                           class="w-full border rounded-lg px-3 py-2">
                </div>
                
                <button type="submit" 
                        class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                    Process
                </button>
            </form>
            
            <div id="result" class="mt-6 hidden">
                <!-- Results will be displayed here -->
            </div>
        </div>
    </div>
    
    <script src="js/auth.js"></script>
    <script src="js/new-feature.js"></script>
</body>
</html>
```

```javascript
// public/js/new-feature.js
class NewFeatureUI {
  constructor() {
    this.apiBase = '/api/new-feature';
    this.init();
  }
  
  init() {
    document.getElementById('newFeatureForm')
      .addEventListener('submit', (e) => this.handleSubmit(e));
  }
  
  async handleSubmit(e) {
    e.preventDefault();
    
    const input = document.getElementById('inputField').value;
    
    try {
      const response = await this.apiCall('/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ input })
      });
      
      this.displayResult(response.result);
    } catch (error) {
      this.showError(error.message);
    }
  }
  
  async apiCall(endpoint, options = {}) {
    const response = await fetch(this.apiBase + endpoint, options);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  displayResult(result) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `
      <h3 class="text-lg font-semibold mb-2">Result:</h3>
      <pre class="bg-gray-100 p-4 rounded">${JSON.stringify(result, null, 2)}</pre>
    `;
    resultDiv.classList.remove('hidden');
  }
  
  showError(message) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `
      <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        Error: ${message}
      </div>
    `;
    resultDiv.classList.remove('hidden');
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new NewFeatureUI();
});
```

## 🧪 Testing

### Unit Tests
```javascript
// tests/services/newFeatureService.test.js
const NewFeatureService = require('../../services/newFeatureService');

describe('NewFeatureService', () => {
  beforeEach(async () => {
    // Setup test data
  });
  
  afterEach(async () => {
    // Cleanup test data
  });
  
  test('should process request correctly', async () => {
    const params = { data: 'test' };
    const result = await NewFeatureService.processRequest(params);
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
  
  test('should handle invalid input', async () => {
    await expect(NewFeatureService.processRequest(null))
      .rejects.toThrow('Invalid input');
  });
});
```

### Integration Tests
```javascript
// tests/integration/api.test.js
const request = require('supertest');
const app = require('../../app');

describe('API Integration Tests', () => {
  let authToken;
  
  beforeAll(async () => {
    // Get auth token for tests
    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        username: 'testuser',
        password: 'testpassword'
      });
    
    authToken = loginResponse.body.token;
  });
  
  test('should create and retrieve data', async () => {
    // Create
    const createResponse = await request(app)
      .post('/api/new-feature')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test Item' });
    
    expect(createResponse.status).toBe(201);
    
    // Retrieve
    const getResponse = await request(app)
      .get(`/api/new-feature/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.name).toBe('Test Item');
  });
});
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/services/newFeatureService.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

## 📊 Monitoring & Debugging

### Logging
```javascript
// services/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'clientsvia-platform' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

### Error Handling
```javascript
// middleware/errorHandler.js
const logger = require('../services/logger');

const errorHandler = (err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    user: req.user?.id,
    timestamp: new Date().toISOString()
  });
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    error: {
      message: isDevelopment ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
      ...(isDevelopment && { stack: err.stack })
    }
  });
};

module.exports = errorHandler;
```

### Performance Monitoring
```javascript
// middleware/performanceMonitor.js
const logger = require('../services/logger');

const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.info({
      type: 'request',
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    // Alert on slow requests
    if (duration > 1000) {
      logger.warn({
        type: 'slow_request',
        duration,
        url: req.url,
        method: req.method
      });
    }
  });
  
  next();
};

module.exports = performanceMonitor;
```

## 🚀 Deployment Preparation

### Environment Configuration
```bash
# Production environment
NODE_ENV=production
PORT=3000

# Database URLs
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/clientsvia
REDIS_URL=redis://user:password@host:port

# Security secrets (generate strong values)
JWT_SECRET=ultra-secure-jwt-secret-for-production
SESSION_SECRET=ultra-secure-session-secret
EMERGENCY_BYPASS_KEY=ultra-secure-emergency-key

# Enable security features
HARDWARE_LOCK_ENABLED=true
GEOIP_ENABLED=true
ALLOWED_COUNTRIES=US,CA,GB

# External services
OPENAI_API_KEY=sk-real-openai-key
SENDGRID_API_KEY=real-sendgrid-key
```

### Build Scripts
```bash
# Build CSS
npm run build-css-prod

# Run production server
npm start
```

### Health Checks
```javascript
// Add to routes/health.js
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
    services: {},
    metrics: {}
  };
  
  // Check database
  try {
    await mongoose.connection.db.admin().ping();
    health.services.mongodb = 'connected';
  } catch (error) {
    health.services.mongodb = 'disconnected';
    health.status = 'unhealthy';
  }
  
  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = 'connected';
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'unhealthy';
  }
  
  // System metrics
  health.metrics = {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  };
  
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

## 🔧 Development Tools

### VS Code Configuration
```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/logs": true
  }
}
```

### ESLint Configuration
```json
// .eslintrc.json
{
  "env": {
    "node": true,
    "es2021": true,
    "jest": true
  },
  "extends": [
    "eslint:recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 12,
    "sourceType": "module"
  },
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off",
    "indent": ["error", 2],
    "quotes": ["error", "single"],
    "semi": ["error", "always"]
  }
}
```

### Git Hooks
```bash
#!/bin/sh
# .git/hooks/pre-commit
npm test
npm run lint
```

---

**Happy Coding!** 🚀  
*For questions, check the docs or create an issue.*
