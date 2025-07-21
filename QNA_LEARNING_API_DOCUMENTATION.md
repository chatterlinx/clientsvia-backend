# Q&A Learning API Documentation
## Enterprise Q&A Learning Queue Management System
### AI Agent Logic Tab - REST API Endpoints

---

## 🚀 **API Base URL**
```
/api/qna-learning
```

---

## 📋 **Available Endpoints**

### 1. **GET** `/api/qna-learning/:companyId`
🔍 **Get pending Q&As with advanced filtering**

**Parameters:**
- `companyId` (path) - Company ID for multi-tenant isolation

**Query Parameters:**
- `status` (string) - Filter by status: `pending`, `approved`, `rejected`, `all` (default: `pending`)
- `priority` (string) - Filter by priority: `low`, `medium`, `high`, `urgent`
- `limit` (number) - Results per page (default: 50, max: 100)
- `offset` (number) - Pagination offset (default: 0)
- `sortBy` (string) - Sort field: `frequency`, `createdAt`, `lastAsked`, `priority` (default: `frequency`)
- `sortOrder` (string) - Sort direction: `asc`, `desc` (default: `desc`)
- `search` (string) - Full-text search across questions and answers
- `minFrequency` (number) - Minimum frequency threshold (default: 1)

**Response:**
```json
{
  "success": true,
  "data": {
    "qnas": [
      {
        "_id": "...",
        "companyId": "...",
        "question": "How much does AC repair cost?",
        "proposedAnswer": "AC repair typically costs $100-$500...",
        "frequency": 5,
        "status": "pending",
        "priority": "high",
        "lastAsked": "2025-07-20T10:30:00Z",
        "createdAt": "2025-07-18T09:15:00Z",
        "tags": ["pricing", "ac", "repair"],
        "aiAgentContext": {
          "confidence": 0.85,
          "intent": "pricing_inquiry",
          "source": "chat"
        }
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 50,
      "offset": 0,
      "hasMore": false
    },
    "stats": {
      "totalPending": 15,
      "totalApproved": 8,
      "totalRejected": 2,
      "approvalRate": "80.0",
      "avgFrequency": 2.3
    }
  }
}
```

---

### 2. **POST** `/api/qna-learning/approve/:id`
✅ **Approve Q&A and prepare for knowledge base**

**Parameters:**
- `id` (path) - Q&A ID to approve

**Request Body:**
```json
{
  "reviewedBy": "admin",
  "notes": "Good question with accurate answer",
  "addToKnowledgeBase": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Q&A approved successfully",
  "data": {
    "qna": { ... },
    "action": "approved",
    "nextStep": "ready_for_knowledge_base",
    "reviewedBy": "admin",
    "notes": "Good question with accurate answer"
  }
}
```

---

### 3. **POST** `/api/qna-learning/reject/:id`
❌ **Reject Q&A and block from reuse**

**Parameters:**
- `id` (path) - Q&A ID to reject

**Request Body:**
```json
{
  "reviewedBy": "admin",
  "reason": "Question too specific to individual case",
  "blockSimilar": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Q&A rejected successfully",
  "data": {
    "qna": { ... },
    "action": "rejected",
    "reason": "Question too specific to individual case",
    "reviewedBy": "admin",
    "blockSimilar": false
  }
}
```

---

### 4. **POST** `/api/qna-learning/bulk-approve`
✅ **Bulk approve multiple Q&As**

**Request Body:**
```json
{
  "ids": ["id1", "id2", "id3"],
  "reviewedBy": "admin",
  "notes": "Batch approval of common questions"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk approval completed: 3 successful, 0 failed",
  "data": {
    "total": 3,
    "successful": 3,
    "failed": 0,
    "details": [...]
  }
}
```

---

### 5. **GET** `/api/qna-learning/analytics/:companyId`
📊 **Get learning analytics and insights**

**Parameters:**
- `companyId` (path) - Company ID for analytics

**Query Parameters:**
- `timeframe` (string) - Time period: `24h`, `7d`, `30d`, `90d` (default: `30d`)

**Response:**
```json
{
  "success": true,
  "data": {
    "timeframe": "30d",
    "stats": {
      "totalPending": 15,
      "totalApproved": 8,
      "totalRejected": 2,
      "approvalRate": "80.0"
    },
    "topQuestions": [
      {
        "question": "How much does AC repair cost?",
        "frequency": 5,
        "status": "pending",
        "priority": "high"
      }
    ],
    "recentActivity": [...],
    "insights": [
      {
        "type": "attention",
        "message": "15 questions are pending review",
        "action": "Review and approve frequently asked questions"
      }
    ]
  }
}
```

---

### 6. **GET** `/api/qna-learning/health`
🔍 **Health check for learning system**

**Response:**
```json
{
  "success": true,
  "service": "qna-learning",
  "status": "healthy",
  "cache": {
    "size": 125,
    "maxSize": 1000,
    "utilizationPercent": 13
  },
  "database": {
    "connected": true
  }
}
```

---

## 🔒 **Security Features**

### Multi-Tenant Isolation
- All endpoints require `companyId` for data isolation
- Cross-company data access prevented at database level
- Secure ObjectId validation

### Input Validation
- MongoDB ObjectId format validation
- Request parameter sanitization
- Error message sanitization in production

### Rate Limiting
- Built-in Express rate limiting
- Bulk operation size limits
- Pagination caps for performance

---

## 📈 **Usage Examples**

### Frontend Integration
```javascript
// Get pending Q&As for company
const response = await fetch(`/api/qna-learning/${companyId}?status=pending&limit=20`);
const data = await response.json();

// Approve a Q&A
await fetch(`/api/qna-learning/approve/${qnaId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    reviewedBy: 'admin',
    notes: 'Approved for knowledge base'
  })
});

// Get analytics
const analytics = await fetch(`/api/qna-learning/analytics/${companyId}?timeframe=7d`);
```

### Error Handling
All endpoints return consistent error format:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": "Technical details (development only)"
}
```

---

## 🎯 **Integration Points**

### With Learning Engine Service
- All endpoints use `learningEngine` service for business logic
- Caching and performance optimization handled transparently
- Analytics and insights generated automatically

### With PendingQnA Model
- Direct database operations for validation
- Mongoose middleware for data consistency
- Automatic priority scoring and tag extraction

### Future Integration (TODO)
- **CompanyQnA Model**: Approved Q&As moved to permanent knowledge base
- **Blocked Patterns**: Prevent similar rejected questions
- **Workflow Integration**: Connect to approval workflows

---

## 🚀 **Ready for Production**

✅ **Enterprise Features:**
- Multi-tenant security
- Advanced filtering and search
- Bulk operations for efficiency
- Real-time analytics and insights
- Health monitoring endpoints
- Comprehensive error handling

✅ **Performance Optimized:**
- Database indexes for fast queries
- In-memory caching system
- Pagination and limits
- Efficient bulk operations

✅ **Developer Friendly:**
- Consistent API patterns
- Clear documentation
- Detailed error messages
- Health check endpoints

---

*Enterprise Q&A Learning System - Ready for AI Agent Logic Tab Integration* 🎊
