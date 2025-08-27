# AI Agent Logic - API Reference

**Last Updated**: December 2024  
**Purpose**: Complete API documentation for AI Agent Logic system

---

## 🎯 Base URLs

- **Production**: `https://clientsvia-backend.onrender.com`
- **Development**: `http://localhost:3000`

---

## 🔐 Authentication

All endpoints require authentication via single session middleware:
```javascript
Headers: {
    'Cookie': 'session=<session_token>',
    'Content-Type': 'application/json'
}
```

---

## 📋 Core Configuration Endpoints

### 1. Get AI Settings

**Endpoint**: `GET /api/admin/:companyID/ai-settings`

**Purpose**: Load complete AI configuration for a company

**Parameters**:
- `companyID` (path) - MongoDB ObjectId of the company

**Response**:
```json
{
    "success": true,
    "companyID": "507f1f77bcf86cd799439011",
    "answerPriority": ["companyKB", "tradeQA", "templates", "learning", "llmFallback"],
    "thresholds": {
        "companyKB": 0.80,
        "tradeQA": 0.75,
        "vector": 0.70,
        "llmFallback": 0.60
    },
    "memory": {
        "mode": "conversational",
        "retentionMinutes": 30
    },
    "escalation": {
        "onNoMatch": true,
        "strategy": "ask-confirm"
    },
    "rePromptAfterTurns": 3,
    "maxPromptsPerCall": 2,
    "modelConfig": {
        "primary": "gemini-pro",
        "fallback": "gpt-4o-mini",
        "allowed": ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"]
    },
    "tradeCategories": ["HVAC Residential", "Plumbing Residential"],
    "agentPersonality": {},
    "behaviorControls": {},
    "responseCategories": {}
}
```

**Status Codes**:
- `200` - Success
- `404` - Company not found
- `401` - Authentication required
- `500` - Server error

---

### 2. Update AI Settings

**Endpoint**: `PUT /api/admin/:companyID/ai-settings`

**Purpose**: Save complete AI configuration for a company

**Parameters**:
- `companyID` (path) - MongoDB ObjectId of the company

**Request Body**:
```json
{
    "answerPriority": ["companyKB", "tradeQA", "templates", "llmFallback"],
    "thresholds": {
        "companyKB": 0.85,
        "tradeQA": 0.75,
        "vector": 0.70,
        "llmFallback": 0.60
    },
    "memory": {
        "mode": "conversational",
        "retentionMinutes": 45
    },
    "escalation": {
        "onNoMatch": true,
        "strategy": "ask-confirm"
    },
    "rePromptAfterTurns": 3,
    "maxPromptsPerCall": 2,
    "modelConfig": {
        "primary": "gemini-pro",
        "fallback": "gpt-4o-mini"
    },
    "tradeCategories": ["HVAC Residential"],
    "agentPersonality": {
        "tone": "professional",
        "responseStyle": "concise"
    }
}
```

**Response**:
```json
{
    "success": true,
    "message": "AI settings updated successfully",
    "companyID": "507f1f77bcf86cd799439011",
    "lastUpdated": "2024-12-07T10:30:00.000Z"
}
```

**Status Codes**:
- `200` - Success
- `400` - Invalid request data
- `404` - Company not found
- `401` - Authentication required
- `500` - Server error

---

## 🎛️ Legacy Agent Settings Endpoint

### Save Agent Settings (Legacy)

**Endpoint**: `POST /api/company/companies/:id/agent-settings`

**Purpose**: Save trade categories and agent intelligence settings (legacy endpoint)

**Parameters**:
- `id` (path) - Company ID

**Request Body**:
```json
{
    "tradeCategories": ["HVAC Residential", "Plumbing Residential"],
    "agentIntelligenceSettings": {
        "memoryMode": "conversational",
        "contextRetention": 30,
        "fallbackThreshold": 0.5
    },
    "aiAgentLogic": {
        "thresholds": {
            "companyQnA": 0.8,
            "tradeQnA": 0.75
        },
        "memorySettings": {
            "memoryMode": "conversational",
            "contextRetention": 30
        }
    }
}
```

**Response**:
```json
{
    "success": true,
    "message": "Agent settings saved successfully",
    "companyId": "507f1f77bcf86cd799439011"
}
```

---

## 🔄 Priority Flow Endpoints

### 1. Get Priority Flow

**Endpoint**: `GET /api/ai-agent/priority-flow/:companyId`

**Purpose**: Load answer priority flow configuration

**Response**:
```json
{
    "success": true,
    "priorityFlow": [
        {
            "id": "companyKB",
            "name": "Company Knowledge Base",
            "priority": 1,
            "isActive": true,
            "threshold": 0.8
        },
        {
            "id": "tradeQA",
            "name": "Trade Categories Q&A",
            "priority": 2,
            "isActive": true,
            "threshold": 0.75
        }
    ]
}
```

### 2. Save Priority Flow

**Endpoint**: `POST /api/ai-agent/priority-flow/:companyId`

**Purpose**: Update answer priority flow configuration

**Request Body**:
```json
{
    "priorityFlow": [
        {
            "id": "companyKB",
            "priority": 1,
            "isActive": true,
            "threshold": 0.8
        },
        {
            "id": "tradeQA",
            "priority": 2,
            "isActive": true,
            "threshold": 0.75
        }
    ]
}
```

### 3. Toggle Knowledge Source

**Endpoint**: `POST /api/ai-agent/priority-flow/:companyId/toggle`

**Purpose**: Enable/disable a specific knowledge source

**Request Body**:
```json
{
    "sourceId": "tradeQA",
    "isActive": false
}
```

### 4. Reorder Priority Flow

**Endpoint**: `POST /api/ai-agent/priority-flow/:companyId/reorder`

**Purpose**: Change the order of knowledge sources

**Request Body**:
```json
{
    "newOrder": ["companyKB", "templates", "tradeQA", "llmFallback"]
}
```

---

## 📊 Analytics & Monitoring Endpoints

### 1. Get Analytics

**Endpoint**: `GET /api/ai-agent/analytics/:companyId`

**Purpose**: Retrieve AI agent performance analytics

**Response**:
```json
{
    "success": true,
    "analytics": {
        "totalCalls": 1250,
        "averageConfidence": 0.82,
        "sourceBreakdown": {
            "companyKB": 45,
            "tradeQA": 30,
            "templates": 15,
            "llmFallback": 10
        },
        "escalationRate": 0.12,
        "period": "last30days"
    }
}
```

### 2. Get Real-time Metrics

**Endpoint**: `GET /api/ai-agent/metrics/:companyId/realtime`

**Purpose**: Get current performance metrics

**Response**:
```json
{
    "success": true,
    "metrics": {
        "activeCallsCount": 3,
        "averageResponseTime": 1.2,
        "currentConfidenceRate": 0.85,
        "lastHourCalls": 15
    }
}
```

---

## 🎨 Template & Response Management

### 1. Get Template Intelligence

**Endpoint**: `GET /api/ai-agent/template-intelligence/:companyId`

**Purpose**: Retrieve template intelligence configuration

### 2. Update Template Intelligence

**Endpoint**: `POST /api/ai-agent/template-intelligence/:companyId`

**Purpose**: Update template intelligence settings

### 3. Get Response Categories

**Endpoint**: `GET /api/ai-agent/response-categories/:companyId`

**Purpose**: Retrieve response category templates

### 4. Update Response Categories

**Endpoint**: `POST /api/ai-agent/response-categories`

**Purpose**: Update response category templates

---

## 🔧 Utility Endpoints

### 1. Optimize Configuration

**Endpoint**: `POST /api/ai-agent/optimize/:companyId`

**Purpose**: Auto-optimize AI settings based on performance data

### 2. Reset to Defaults

**Endpoint**: `POST /api/ai-agent/reset-defaults/:companyId`

**Purpose**: Reset AI configuration to system defaults

### 3. Save Complete Configuration

**Endpoint**: `POST /api/ai-agent/save-config`

**Purpose**: Save complete AI agent configuration

**Request Body**:
```json
{
    "answerPriorityFlow": [...],
    "agentPersonality": {...},
    "behaviorControls": {...}
}
```

---

## ⚠️ Error Responses

### Standard Error Format
```json
{
    "success": false,
    "error": "Error message",
    "code": "ERROR_CODE",
    "details": "Additional error details"
}
```

### Common Error Codes
- `COMPANY_NOT_FOUND` - Company ID not found
- `INVALID_REQUEST` - Malformed request data
- `AUTHENTICATION_REQUIRED` - Missing or invalid authentication
- `VALIDATION_ERROR` - Request data validation failed
- `INTERNAL_ERROR` - Server-side error

---

## 🔍 Request Examples

### cURL Examples

**Get AI Settings**:
```bash
curl -X GET "https://clientsvia-backend.onrender.com/api/admin/507f1f77bcf86cd799439011/ai-settings" \
  -H "Cookie: session=<session_token>" \
  -H "Content-Type: application/json"
```

**Update AI Settings**:
```bash
curl -X PUT "https://clientsvia-backend.onrender.com/api/admin/507f1f77bcf86cd799439011/ai-settings" \
  -H "Cookie: session=<session_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": {
      "companyKB": 0.85,
      "tradeQA": 0.75
    },
    "memory": {
      "mode": "conversational",
      "retentionMinutes": 45
    }
  }'
```

### JavaScript Fetch Examples

**Load Configuration**:
```javascript
async function loadAISettings(companyId) {
    const response = await fetch(`/api/admin/${companyId}/ai-settings`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    
    if (response.ok) {
        return await response.json();
    } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
}
```

**Save Configuration**:
```javascript
async function saveAISettings(companyId, settings) {
    const response = await fetch(`/api/admin/${companyId}/ai-settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
    });
    
    if (response.ok) {
        return await response.json();
    } else {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
    }
}
```

---

## 🎯 Integration Notes

### Frontend Integration
- All endpoints expect company ID to be available via `getCurrentCompanyId()`
- Error handling should display user-friendly messages
- Loading states should be shown during API calls
- Success feedback should confirm save operations

### Backend Integration
- All routes use `authenticateSingleSession` middleware
- Company ID validation ensures multi-tenant isolation [[memory:7283147]]
- MongoDB operations use Company model with `aiAgentLogic` field
- Redis cache invalidation occurs on configuration updates [[memory:7289715]]

### Performance Considerations
- Configuration data cached in Redis for 5 minutes
- Bulk operations should be batched when possible
- Real-time metrics have higher update frequency
- Analytics data may be cached for longer periods

---

*This API reference is current as of December 2024. Update as endpoints change or new functionality is added.*
