# API Reference - ClientsVia AI Platform

## 📡 Complete API Documentation

### Base URL
```
Development: http://localhost:3000
Production: https://api.clientsvia.com
```

### Authentication
All API endpoints (except public routes) require JWT authentication:
```http
Authorization: Bearer <your-jwt-token>
```

## 🔐 Authentication API

### POST /auth/login
Authenticate user and create session

**Request:**
```json
{
  "username": "admin",
  "password": "password",
  "deviceId": "unique-device-identifier",
  "hardwareId": "hardware-fingerprint"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user123",
    "username": "admin",
    "role": "admin"
  },
  "expiresIn": "15m"
}
```

**Errors:**
- `401` - Invalid credentials
- `403` - Account locked
- `409` - Session conflict (another session active)
- `423` - Geographic restriction

### POST /auth/logout
Terminate current session

**Response:**
```json
{
  "success": true,
  "message": "Successfully logged out"
}
```

### POST /auth/refresh
Refresh JWT token

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

### GET /auth/status
Get current authentication status

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "id": "user123",
    "username": "admin"
  },
  "sessionInfo": {
    "deviceId": "device123",
    "location": "US",
    "lastActivity": "2025-01-27T10:30:00Z"
  }
}
```

## 🤖 AI Agent Logic API

### GET /ai-agent-logic/config/:companyId
Get AI agent configuration for a company

**Parameters:**
- `companyId` (string): Company identifier

**Response:**
```json
{
  "success": true,
  "config": {
    "answerPriorityFlow": [
      {
        "id": "priority-1",
        "name": "Emergency Services",
        "priority": 1,
        "enabled": true,
        "rules": ["urgent", "emergency", "immediate"]
      }
    ],
    "templateIntelligence": {
      "enabled": true,
      "adaptiveResponses": true,
      "learningMode": "active"
    },
    "agentPersonality": {
      "tone": "professional",
      "responseStyle": "concise",
      "empathyLevel": 7
    }
  }
}
```

### PUT /ai-agent-logic/config/:companyId
Update AI agent configuration

**Request:**
```json
{
  "answerPriorityFlow": [...],
  "templateIntelligence": {...},
  "agentPersonality": {...}
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "updatedAt": "2025-01-27T10:30:00Z"
}
```

### POST /ai-agent-logic/toggle/:companyId
Toggle specific AI features

**Request:**
```json
{
  "feature": "templateIntelligence",
  "enabled": false
}
```

**Response:**
```json
{
  "success": true,
  "feature": "templateIntelligence",
  "enabled": false
}
```

### POST /ai-agent-logic/reset/:companyId
Reset AI configuration to defaults

**Response:**
```json
{
  "success": true,
  "message": "Configuration reset to defaults",
  "resetAt": "2025-01-27T10:30:00Z"
}
```

### POST /ai-agent-logic/reorder/:companyId
Reorder answer priority flow

**Request:**
```json
{
  "newOrder": ["priority-2", "priority-1", "priority-3"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Priority order updated",
  "newOrder": ["priority-2", "priority-1", "priority-3"]
}
```

### GET /ai-agent-logic/analytics/:companyId
Get AI agent performance analytics

**Query Parameters:**
- `timeframe` (optional): "24h", "7d", "30d" (default: "24h")
- `metrics` (optional): Comma-separated list of metrics

**Response:**
```json
{
  "success": true,
  "analytics": {
    "responseTime": {
      "average": 245,
      "median": 180,
      "p95": 450
    },
    "accuracy": {
      "overallScore": 0.94,
      "templateMatching": 0.96,
      "intentRecognition": 0.92
    },
    "usage": {
      "totalQueries": 1247,
      "successfulResponses": 1172,
      "failureRate": 0.06
    },
    "learning": {
      "adaptationsCount": 23,
      "improvementScore": 0.12
    }
  }
}
```

### POST /ai-agent-logic/test/:companyId
Test AI agent with sample query

**Request:**
```json
{
  "query": "I need emergency plumbing service",
  "context": {
    "location": "New York",
    "time": "2025-01-27T10:30:00Z",
    "previousInteractions": []
  }
}
```

**Response:**
```json
{
  "success": true,
  "response": {
    "text": "I understand you need emergency plumbing service in New York. Let me connect you with our 24/7 emergency team immediately.",
    "confidence": 0.95,
    "matchedTemplate": "emergency-plumbing",
    "priorityLevel": 1,
    "processingTime": 180,
    "nextActions": [
      "schedule_emergency_call",
      "collect_contact_info"
    ]
  }
}
```

## 🏢 Company Management API

### GET /companies
Get all companies (admin only)

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `search` (optional): Search term

**Response:**
```json
{
  "success": true,
  "companies": [
    {
      "id": "company123",
      "name": "ABC Plumbing Services",
      "industry": "plumbing",
      "status": "active",
      "createdAt": "2025-01-15T09:00:00Z",
      "aiConfig": {
        "enabled": true,
        "lastUpdated": "2025-01-25T14:30:00Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

### POST /companies
Create new company

**Request:**
```json
{
  "name": "XYZ HVAC Services",
  "industry": "hvac",
  "contactInfo": {
    "email": "admin@xyzhvac.com",
    "phone": "+1-555-0123",
    "address": "123 Business St, City, State 12345"
  },
  "aiConfig": {
    "personality": "professional",
    "responseStyle": "detailed"
  }
}
```

**Response:**
```json
{
  "success": true,
  "company": {
    "id": "company456",
    "name": "XYZ HVAC Services",
    "industry": "hvac",
    "status": "active",
    "createdAt": "2025-01-27T10:30:00Z"
  }
}
```

### GET /companies/:companyId
Get specific company details

**Response:**
```json
{
  "success": true,
  "company": {
    "id": "company123",
    "name": "ABC Plumbing Services",
    "industry": "plumbing",
    "status": "active",
    "contactInfo": {...},
    "aiConfig": {...},
    "statistics": {
      "totalQueries": 5432,
      "avgResponseTime": 245,
      "customerSatisfaction": 4.7
    }
  }
}
```

### PUT /companies/:companyId
Update company information

**Request:**
```json
{
  "name": "ABC Premium Plumbing Services",
  "contactInfo": {
    "email": "contact@abcplumbing.com"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Company updated successfully",
  "updatedAt": "2025-01-27T10:30:00Z"
}
```

### DELETE /companies/:companyId
Delete company (admin only)

**Response:**
```json
{
  "success": true,
  "message": "Company deleted successfully"
}
```

## 📚 Knowledge Base API

### GET /knowledge/:companyId
Get company knowledge base

**Query Parameters:**
- `category` (optional): Filter by category
- `search` (optional): Search terms
- `limit` (optional): Number of results

**Response:**
```json
{
  "success": true,
  "knowledgeBase": [
    {
      "id": "kb123",
      "question": "What are your emergency service hours?",
      "answer": "We provide 24/7 emergency plumbing services.",
      "category": "emergency",
      "confidence": 0.98,
      "lastUpdated": "2025-01-20T09:00:00Z"
    }
  ]
}
```

### POST /knowledge/:companyId
Add knowledge entry

**Request:**
```json
{
  "question": "Do you offer financing options?",
  "answer": "Yes, we offer 0% financing for qualified customers on repairs over $500.",
  "category": "financing",
  "tags": ["payment", "financing", "cost"]
}
```

**Response:**
```json
{
  "success": true,
  "id": "kb456",
  "message": "Knowledge entry added successfully"
}
```

### PUT /knowledge/:companyId/:entryId
Update knowledge entry

**Request:**
```json
{
  "answer": "Yes, we offer 0% financing for 12 months on qualified repairs over $500."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Knowledge entry updated successfully"
}
```

### DELETE /knowledge/:companyId/:entryId
Delete knowledge entry

**Response:**
```json
{
  "success": true,
  "message": "Knowledge entry deleted successfully"
}
```

## 📞 Agent Interaction API

### POST /agent/query
Process user query through AI agent

**Request:**
```json
{
  "companyId": "company123",
  "query": "I need a plumber for a leaky faucet",
  "context": {
    "userId": "user456",
    "location": "New York, NY",
    "previousInteractions": [],
    "preferredContact": "phone"
  }
}
```

**Response:**
```json
{
  "success": true,
  "response": {
    "text": "I can help you with your leaky faucet. Based on your location in New York, I'll connect you with one of our licensed plumbers. What's the best time for us to call you?",
    "confidence": 0.92,
    "intent": "service_request",
    "suggestedActions": [
      {
        "type": "schedule_call",
        "label": "Schedule Service Call",
        "data": { "serviceType": "plumbing", "issue": "leaky_faucet" }
      }
    ],
    "followUpQuestions": [
      "Is this an emergency?",
      "What type of faucet is it?",
      "When did the leak start?"
    ]
  }
}
```

### POST /agent/feedback
Provide feedback on agent response

**Request:**
```json
{
  "interactionId": "int789",
  "rating": 5,
  "feedback": "Very helpful and quick response",
  "wasHelpful": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Feedback recorded successfully"
}
```

## 📊 Analytics API

### GET /analytics/:companyId/performance
Get agent performance metrics

**Query Parameters:**
- `timeframe`: "1h", "24h", "7d", "30d", "90d"
- `granularity`: "hour", "day", "week"

**Response:**
```json
{
  "success": true,
  "metrics": {
    "responseTime": {
      "current": 245,
      "trend": "+5%",
      "distribution": {
        "p50": 180,
        "p90": 350,
        "p95": 450,
        "p99": 800
      }
    },
    "accuracy": {
      "intentRecognition": 0.94,
      "responseRelevance": 0.91,
      "userSatisfaction": 4.6
    },
    "volume": {
      "totalQueries": 1247,
      "uniqueUsers": 892,
      "peakHour": "14:00-15:00"
    }
  }
}
```

### GET /analytics/:companyId/learning
Get AI learning progress

**Response:**
```json
{
  "success": true,
  "learning": {
    "adaptations": {
      "total": 156,
      "lastWeek": 23,
      "categories": {
        "response_templates": 89,
        "intent_recognition": 34,
        "personality_adjustments": 33
      }
    },
    "improvement": {
      "accuracyGain": 0.12,
      "responseTimeReduction": 67,
      "userSatisfactionIncrease": 0.3
    },
    "knowledgeGrowth": {
      "newEntries": 45,
      "updatedEntries": 78,
      "deprecatedEntries": 12
    }
  }
}
```

## 🔍 System Monitoring API

### GET /health
System health check (public endpoint)

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-27T10:30:00Z",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected",
    "ai_services": "operational"
  },
  "metrics": {
    "uptime": 86400,
    "memoryUsage": 0.65,
    "cpuUsage": 0.23
  }
}
```

### GET /monitoring/sessions
Get active sessions (admin only)

**Response:**
```json
{
  "success": true,
  "activeSessions": [
    {
      "userId": "user123",
      "deviceId": "device456",
      "location": "US",
      "lastActivity": "2025-01-27T10:25:00Z",
      "duration": 1800
    }
  ],
  "totalSessions": 1
}
```

## 🚨 Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "companyId",
      "reason": "Company not found"
    },
    "timestamp": "2025-01-27T10:30:00Z",
    "requestId": "req_123456789"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTHENTICATION_REQUIRED` | 401 | Missing or invalid authentication |
| `INSUFFICIENT_PERMISSIONS` | 403 | User lacks required permissions |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

## 🔑 Rate Limiting

### Limits
- **Authentication**: 5 requests per minute
- **General API**: 100 requests per 15 minutes
- **AI Queries**: 60 requests per minute
- **Analytics**: 30 requests per minute

### Headers
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1643287200
```

## 📝 Request/Response Examples

### Complete Authentication Flow
```bash
# 1. Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "password",
    "deviceId": "device123",
    "hardwareId": "hardware456"
  }'

# 2. Use token for API calls
curl -X GET http://localhost:3000/ai-agent-logic/config/company123 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 3. Refresh token
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 4. Logout
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### AI Agent Configuration
```bash
# Get current configuration
curl -X GET http://localhost:3000/ai-agent-logic/config/company123 \
  -H "Authorization: Bearer <token>"

# Update configuration
curl -X PUT http://localhost:3000/ai-agent-logic/config/company123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentPersonality": {
      "tone": "friendly",
      "responseStyle": "detailed",
      "empathyLevel": 8
    }
  }'

# Test agent
curl -X POST http://localhost:3000/ai-agent-logic/test/company123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I need help with my heating system",
    "context": { "location": "Boston", "urgency": "medium" }
  }'
```

---

**API Version**: 1.0.0  
**Last Updated**: January 2025  
**Support**: api-support@clientsvia.com
