# 📚 API DOCUMENTATION - ClientsVia Production Platform

**Version:** 2.1  
**Last Updated:** October 16, 2025  
**Status:** Production Ready

---

## 🔐 **AUTHENTICATION**

All endpoints require JWT authentication via the `Authorization` header:

```http
Authorization: Bearer <your-jwt-token>
```

---

## 🏢 **COMPANY CONFIGURATION ENDPOINTS**

Base URL: `/api/company/:companyId/configuration`

---

### **1. GET Configuration Overview**

Load complete configuration for a company.

**Endpoint:** `GET /api/company/:companyId/configuration`

**Response:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "clonedFrom": "507f191e810c19729de860ea",
  "clonedAt": "2025-10-13T10:00:00.000Z",
  "variableCount": 15,
  "scenarioCount": 47,
  "fillerWordsCount": 12,
  "urgencyKeywordsCount": 17,
  "isLive": false,
  "lastUpdatedAt": "2025-10-13T11:30:00.000Z"
}
```

---

### **2. GET Variables**

Load all company-specific variables.

**Endpoint:** `GET /api/company/:companyId/configuration/variables`

**Response:**
```json
{
  "variables": {
    "companyName": "Joe's Plumbing",
    "servicecallprice": "125",
    "phone": "+1-239-555-0100",
    "email": "contact@joesplumbing.com"
  },
  "definitions": [
    {
      "key": "companyName",
      "label": "Company Name",
      "type": "text",
      "required": true
    }
  ]
}
```

---

### **3. POST Preview Variable Changes**

Preview changes before applying.

**Endpoint:** `POST /api/company/:companyId/configuration/variables/preview`

**Request Body:**
```json
{
  "variables": {
    "servicecallprice": "150",
    "email": "newemail@joesplumbing.com"
  }
}
```

**Response:**
```json
{
  "changes": [
    {
      "key": "servicecallprice",
      "label": "Service Call Price",
      "type": "currency",
      "oldValue": "125",
      "newValue": "150",
      "status": "modified"
    }
  ],
  "examples": [
    {
      "scenarioName": "Book Appointment",
      "before": "Our service call is $125",
      "after": "Our service call is $150"
    }
  ],
  "affectedScenarios": 5,
  "previewToken": "abc123...",
  "expiresAt": "2025-10-13T12:00:00.000Z"
}
```

---

### **4. POST Apply Variable Changes**

Apply previewed changes with idempotency.

**Endpoint:** `POST /api/company/:companyId/configuration/variables/apply`

**Request Body:**
```json
{
  "previewToken": "abc123...",
  "idempotencyKey": "uuid-v4-key"
}
```

**Response:**
```json
{
  "success": true,
  "applied": 2,
  "message": "Variables updated successfully"
}
```

**Error Response (409 Conflict):**
```json
{
  "error": "Already applied",
  "message": "This change has already been applied",
  "appliedAt": "2025-10-13T11:45:00.000Z"
}
```

---

### **5. GET Readiness Score**

Calculate and return configuration readiness.

**Endpoint:** `GET /api/company/:companyId/configuration/readiness`

**Response:**
```json
{
  "score": 85,
  "canGoLive": true,
  "isLive": false,
  "blockers": [],
  "components": {
    "variables": { "score": 25, "max": 25, "status": "pass" },
    "fillerWords": { "score": 15, "max": 15, "status": "pass" },
    "urgencyKeywords": { "score": 10, "max": 10, "status": "pass" },
    "scenarios": { "score": 20, "max": 20, "status": "pass" },
    "templateCloned": { "score": 15, "max": 15, "status": "pass" },
    "readiness": { "score": 0, "max": 15, "status": "pending" }
  },
  "recommendations": [
    "Click 'Go Live' to activate your AI agent"
  ]
}
```

**With Blockers:**
```json
{
  "score": 45,
  "canGoLive": false,
  "blockers": [
    {
      "code": "R01",
      "message": "Required variable 'servicecallprice' is missing",
      "severity": "error",
      "fixTarget": "variables/servicecallprice"
    }
  ]
}
```

---

### **6. POST Go Live**

Activate the AI agent for production.

**Endpoint:** `POST /api/company/:companyId/configuration/go-live`

**Response:**
```json
{
  "success": true,
  "isLive": true,
  "activatedAt": "2025-10-13T12:00:00.000Z",
  "message": "AI Agent is now live!"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Not ready",
  "message": "Configuration score must be at least 80 to go live",
  "currentScore": 65,
  "blockers": [...]
}
```

---

### **7. GET Filler Words**

Load filler words (inherited + custom).

**Endpoint:** `GET /api/company/:companyId/configuration/filler-words`

**Response:**
```json
{
  "inherited": ["um", "uh", "like", "you know"],
  "custom": ["y'all", "reckon"],
  "all": ["um", "uh", "like", "you know", "y'all", "reckon"],
  "totalCount": 6
}
```

---

### **8. POST Add Filler Words**

Add custom filler words.

**Endpoint:** `POST /api/company/:companyId/configuration/filler-words`

**Request Body:**
```json
{
  "words": ["howdy", "gonna"]
}
```

**Response:**
```json
{
  "success": true,
  "added": ["howdy", "gonna"],
  "custom": ["y'all", "reckon", "howdy", "gonna"],
  "totalCount": 8
}
```

---

### **9. DELETE Remove Filler Word**

Remove a custom filler word.

**Endpoint:** `DELETE /api/company/:companyId/configuration/filler-words/:word`

**Response:**
```json
{
  "success": true,
  "removed": "howdy",
  "custom": ["y'all", "reckon", "gonna"]
}
```

---

### **10. POST Reset Filler Words**

Reset custom filler words to inherited only.

**Endpoint:** `POST /api/company/:companyId/configuration/filler-words/reset`

**Response:**
```json
{
  "success": true,
  "message": "Custom filler words reset",
  "inherited": ["um", "uh", "like"],
  "custom": []
}
```

---

### **11. GET Urgency Keywords**

Load urgency keywords (inherited + custom).

**Endpoint:** `GET /api/company/:companyId/configuration/urgency-keywords`

**Response:**
```json
{
  "inherited": [
    { "word": "emergency", "weight": 0.5, "category": "Critical" },
    { "word": "flooding", "weight": 0.4, "category": "Water" }
  ],
  "custom": [
    { "word": "backup", "weight": 0.3, "category": "Plumbing" }
  ],
  "all": [...],
  "totalCount": 18,
  "totalWeight": "6.70"
}
```

---

### **12. POST Sync Urgency Keywords**

Sync urgency keywords from template (updates inherited).

**Endpoint:** `POST /api/company/:companyId/configuration/urgency-keywords/sync`

**Response:**
```json
{
  "success": true,
  "inherited": [...],
  "syncedCount": 17,
  "message": "Synced 17 urgency keywords from template"
}
```

---

## 🌐 **GLOBAL AI BRAIN ENDPOINTS**

Base URL: `/api/admin/global-instant-responses`

---

### **13. GET Urgency Keywords (Template)**

Load urgency keywords for a template.

**Endpoint:** `GET /api/admin/global-instant-responses/:id/urgency-keywords`

**Response:**
```json
{
  "keywords": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "word": "emergency",
      "weight": 0.5,
      "category": "Critical",
      "examples": ["It's an emergency!", "Emergency situation"]
    }
  ],
  "totalCount": 17,
  "totalWeight": "6.70"
}
```

---

### **14. POST Add Urgency Keyword**

Add new urgency keyword to template.

**Endpoint:** `POST /api/admin/global-instant-responses/:id/urgency-keywords`

**Request Body:**
```json
{
  "word": "urgent",
  "weight": 0.4,
  "category": "High Priority",
  "examples": ["This is urgent", "Urgent matter"]
}
```

**Response:**
```json
{
  "success": true,
  "keyword": {
    "_id": "507f1f77bcf86cd799439011",
    "word": "urgent",
    "weight": 0.4,
    "category": "High Priority"
  },
  "message": "Urgency keyword added successfully"
}
```

---

### **15. PATCH Update Urgency Keyword**

Update existing urgency keyword.

**Endpoint:** `PATCH /api/admin/global-instant-responses/:id/urgency-keywords/:keywordId`

**Request Body:**
```json
{
  "weight": 0.5,
  "category": "Critical"
}
```

**Response:**
```json
{
  "success": true,
  "keyword": { ... },
  "message": "Urgency keyword updated successfully"
}
```

---

### **16. DELETE Remove Urgency Keyword**

Delete urgency keyword from template.

**Endpoint:** `DELETE /api/admin/global-instant-responses/:id/urgency-keywords/:keywordId`

**Response:**
```json
{
  "success": true,
  "message": "Urgency keyword deleted successfully"
}
```

---

### **17. POST Seed Default Keywords**

Seed 17 default urgency keywords.

**Endpoint:** `POST /api/admin/global-instant-responses/:id/urgency-keywords/seed-defaults`

**Response:**
```json
{
  "success": true,
  "count": 17,
  "message": "Seeded 17 default urgency keywords",
  "keywords": [...]
}
```

---

## ⚙️ **ERROR CODES**

### **Validation Errors (400)**
- `COMPANY_ID_REQUIRED` - Missing companyId parameter
- `VARIABLE_VALIDATION_ERROR` - Variable failed type validation
- `PREVIEW_TOKEN_EXPIRED` - Preview token has expired
- `PREVIEW_TOKEN_INVALID` - Preview token hash mismatch

### **Authorization Errors (401, 403)**
- `AUTH_REQUIRED` - No authentication token provided
- `COMPANY_ACCESS_DENIED` - User does not have access to this company
- `NOT_READY` - Configuration not ready to go live

### **Conflict Errors (409)**
- `ALREADY_APPLIED` - Idempotency: change already applied
- `ALREADY_LIVE` - AI agent is already active

### **Server Errors (500)**
- `CACHE_ERROR` - Redis cache operation failed
- `DATABASE_ERROR` - MongoDB operation failed
- `VALIDATION_SERVICE_ERROR` - Readiness calculation failed

---

## 🔄 **RATE LIMITS**

- **Preview endpoint:** 10 requests/minute per company
- **Apply endpoint:** 5 requests/minute per company (with idempotency)
- **Go Live endpoint:** 3 requests/hour per company
- **All other endpoints:** 100 requests/minute per user

---

## 📊 **CACHING**

### **Redis Cache Keys:**
- `company:${companyId}` - Company data (TTL: 1 hour)
- `readiness:${companyId}` - Readiness score (TTL: 30 seconds)
- `company-phone:${phoneNumber}` - Phone lookup (TTL: 1 hour)

### **Cache Invalidation:**
Automatic cache invalidation on:
- Variable updates
- Filler words changes
- Urgency keywords sync
- Go Live activation

---

## 🧪 **TESTING**

### **Example cURL Commands:**

**Get Configuration:**
```bash
curl -X GET \
  https://api.clientsvia.ai/api/company/507f1f77bcf86cd799439011/configuration \
  -H 'Authorization: Bearer your-jwt-token'
```

**Preview Changes:**
```bash
curl -X POST \
  https://api.clientsvia.ai/api/company/507f1f77bcf86cd799439011/configuration/variables/preview \
  -H 'Authorization: Bearer your-jwt-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "variables": {
      "servicecallprice": "150"
    }
  }'
```

**Go Live:**
```bash
curl -X POST \
  https://api.clientsvia.ai/api/company/507f1f77bcf86cd799439011/configuration/go-live \
  -H 'Authorization: Bearer your-jwt-token'
```

---

---

## 📊 **PRODUCTION MONITORING ENDPOINTS**

### **1. GET /api/metrics**

Get comprehensive application metrics (admin only).

**Authentication:** JWT Bearer Token (admin role required)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-10-16T12:00:00.000Z",
  "metrics": {
    "requests": {
      "total": 12543,
      "byMethod": { "GET": 8234, "POST": 3421, "PATCH": 888 },
      "topRoutes": { "/health": 5000, "/api/company/:id": 2000 },
      "successRate": 98,
      "errorRate": 2
    },
    "performance": {
      "avgResponseTime": 45,
      "minResponseTime": 3,
      "maxResponseTime": 234,
      "p50": 38,
      "p95": 120,
      "p99": 200
    },
    "errors": {
      "total": 23,
      "byType": { "ValidationError": 15, "NotFoundError": 8 }
    },
    "health": {
      "status": "healthy",
      "requestsPerSecond": 5,
      "errorRate": 2
    }
  }
}
```

---

### **2. GET /api/metrics/health**

Quick health status check (public).

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-10-16T12:00:00.000Z",
  "health": {
    "status": "healthy",
    "requestsPerSecond": 5,
    "errorRate": 2
  },
  "uptime": {
    "seconds": 86400,
    "formatted": "1d 0h 0m 0s"
  },
  "performance": {
    "avgResponseTime": 45,
    "p95": 120
  }
}
```

---

### **3. GET /api/metrics/performance**

Performance metrics only (admin only).

**Authentication:** JWT Bearer Token (admin role required)

**Response:**
```json
{
  "success": true,
  "performance": {
    "avgResponseTime": 45,
    "p50": 38,
    "p95": 120,
    "p99": 200
  },
  "requests": {
    "total": 12543,
    "successRate": 98,
    "errorRate": 2
  }
}
```

---

### **4. GET /api/metrics/errors**

Recent errors (admin only).

**Authentication:** JWT Bearer Token (admin role required)

**Response:**
```json
{
  "success": true,
  "errors": {
    "total": 23,
    "byType": { "ValidationError": 15, "NotFoundError": 8 },
    "recent": [
      {
        "type": "ValidationError",
        "message": "Invalid company ID format",
        "path": "/api/company/invalid-id",
        "method": "GET",
        "timestamp": "2025-10-16T12:00:00.000Z"
      }
    ]
  }
}
```

---

### **5. POST /api/metrics/reset**

Reset all metrics (admin only).

**Authentication:** JWT Bearer Token (admin role required)

**Response:**
```json
{
  "success": true,
  "message": "Metrics reset successfully",
  "timestamp": "2025-10-16T12:00:00.000Z"
}
```

---

## 🏥 **HEALTH CHECK ENDPOINTS**

### **GET /health**

Comprehensive health check with service status.

**Response:**
```json
{
  "status": "healthy",
  "environment": "production",
  "timestamp": "2025-10-16T12:00:00.000Z",
  "services": {
    "mongodb": {
      "status": "connected",
      "responseTime": 3
    },
    "redis": {
      "status": "connected",
      "responseTime": 1
    }
  },
  "system": {
    "memory": {
      "heapUsed": 125,
      "heapTotal": 256,
      "rss": 450
    },
    "uptime": 86400,
    "nodeVersion": "v20.10.0"
  }
}
```

---

### **GET /healthz**

Simple health check for load balancers.

**Response:**
```json
{
  "ok": true
}
```

---

## 📖 **FURTHER READING**

- **Multi-Tenant Architecture:** See `MULTI-TENANT-ARCHITECTURE.md`
- **User Guide:** See `USER-GUIDE.md`
- **Audit Report:** See `FINAL-AUDIT-REPORT.md`
- **Production Setup:** See `PRODUCTION-ENVIRONMENT-SETUP.md`
- **Production Readiness:** See `PRODUCTION-READINESS-AUDIT.md`
- **Deployment Checklist:** See `PRODUCTION-DEPLOYMENT-CHECKLIST.md`

