# Complete Agent Response Route Map

## Summary of All Routes and Data Sources

Based on my comprehensive analysis of the codebase, here are **ALL** the routes and data sources the AI agent uses to find responses to callers:

## 🔄 **Primary Call Flow Routes**

### 1. **Main Call Entry Point**
- **Route:** `POST /api/ai-agent/incoming-call`
- **Handler:** `routes/aiAgentHandler.js`
- **Purpose:** Initial Twilio call reception and company identification

### 2. **Ongoing Conversation**
- **Route:** `POST /api/ai-agent/speech-input`  
- **Handler:** `routes/aiAgentHandler.js`
- **Purpose:** Handle speech input during active calls

### 3. **Call Status Management**
- **Route:** `POST /api/ai-agent/call-status`
- **Handler:** `routes/aiAgentHandler.js`
- **Purpose:** Track call status and cleanup sessions

### 4. **Agent Testing**
- **Route:** `POST /api/ai-agent/test`
- **Handler:** `routes/aiAgentHandler.js`
- **Purpose:** Test agent responses with authentication

## 🧠 **Intelligence Processing Routes**

### Primary Intelligence Engine
- **Service:** `services/realTimeAgentMiddleware.js`
- **Class:** `RealTimeAgentMiddleware`
- **Method:** `handleIncomingCall()`

### Super-Intelligent Processing
- **Service:** `services/superIntelligentAgent.js`
- **Class:** `SuperIntelligentAgentEngine`
- **Method:** `handleQuery()`

### Legacy Agent Service
- **Service:** `services/agent.js`
- **Main Function:** `answerQuestion()`

## 🗂️ **Data Source Hierarchy (Response Priority Order)**

### **TIER 1: Company-Specific Protocols (Confidence: 0.95)**
- **Source:** `company.agentSetup.protocols`
- **Function:** `checkSpecificProtocols()`
- **Data Type:** Exact scenario matches
- **Use Case:** Specific company procedures and scripts

### **TIER 2: Personality Responses (Confidence: 0.85)**
- **Source:** `utils/personalityResponses_enhanced.js`
- **Function:** `checkPersonalityScenarios()`
- **Data Type:** Common interaction patterns
- **Use Case:** Greetings, complaints, general politeness

### **TIER 3: Approved Knowledge Base (Confidence: 0.9)**
- **Source:** MongoDB `KnowledgeEntry` collection
- **Query:** Direct database lookup
- **Filters:** 
  - `companyId` match
  - `approved: true`
  - Category match
  - Regex pattern matching

### **TIER 4: Intelligent Q&A Matching (Confidence: 0.75)**
- **Source:** `KnowledgeEntry` collection
- **Function:** `extractQuickAnswerFromQA()`
- **Algorithm:** 
  - Fuzzy string matching
  - Levenshtein distance calculation
  - Keyword overlap scoring
  - Threshold: 0.15 (configurable)

### **TIER 5: Company Category Q&As (Confidence: 0.8)**
- **Source:** `company.agentSetup.categoryQAs`
- **Storage:** In-memory cache (`categoryQACache`)
- **Processing:** Parsed text format to structured data
- **Function:** `extractQuickAnswerFromQA()`

### **TIER 6: Smart Conversational AI (Confidence: 0.7)**
- **Source:** AI-generated responses
- **Function:** `generateSmartConversationalResponse()`
- **Context:** Company data, conversation history, categories

### **TIER 7: Main Agent Script (Confidence: Variable)**
- **Source:** `company.agentSetup.mainAgentScript`
- **Function:** `processMainAgentScript()`
- **Features:** Template matching, placeholder replacement

### **TIER 8: Intelligent Response Generation (Confidence: 0.6)**
- **Source:** AI reasoning with company context
- **Function:** `generateIntelligentResponse()`
- **Data:** Company Q&As, categories, conversation history

### **TIER 9: LLM Fallback (Confidence: Variable)**
- **Source:** Google Vertex AI (Gemini model)
- **Function:** `callModel()`
- **Condition:** `company.aiSettings.llmFallbackEnabled: true`
- **API:** Google Cloud AI Platform

### **TIER 10: Human Escalation (Confidence: 0)**
- **Source:** Default escalation message
- **Trigger:** All previous methods failed
- **Action:** Transfer to human agent

## 📊 **Database Collections Used**

### 1. **Company Collection (`companiesCollection`)**
```javascript
// AI Configuration
company.aiSettings = {
  enabled: Boolean,
  model: String,
  llmFallbackEnabled: Boolean,
  customEscalationMessage: String,
  fuzzyMatchThreshold: Number
}

// Agent Setup
company.agentSetup = {
  mainAgentScript: String,
  categoryQAs: String,
  protocols: Object,
  categories: Array,
  placeholders: Array
}

// Phone Numbers
company.phoneNumber: String,
company.twilioNumbers: Array
```

### 2. **KnowledgeEntry Collection**
```javascript
{
  companyId: ObjectId,
  question: String,
  answer: String,
  category: String,
  keywords: Array,
  approved: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### 3. **Monitoring Collections**
```javascript
// AgentInteraction
{
  companyId: ObjectId,
  callerId: String,
  userQuery: String,
  agentResponse: String,
  confidence: Number,
  responseTime: Number,
  metadata: Object
}

// AgentApproval/Disapproval (Blacklist)
{
  companyId: ObjectId,
  query: String,
  response: String,
  approved: Boolean,
  reason: String
}
```

## 🔍 **Search and Matching Algorithms**

### 1. **Exact Matching**
- Company protocols
- Direct database queries
- Personality scenario patterns

### 2. **Fuzzy String Matching**
- Levenshtein distance calculation
- Configurable threshold (default: 0.15)
- Keyword overlap scoring
- Case-insensitive comparison

### 3. **Semantic Similarity**
- OpenAI embeddings (planned/limited)
- Cosine similarity calculation
- Vector database integration (simulated)
- Confidence threshold: 0.85

### 4. **Regex Pattern Matching**
- Knowledge base question matching
- Category-based filtering
- Case-insensitive regex patterns

## 🔧 **External Integrations**

### 1. **Twilio Voice API**
- Call reception and management
- TwiML response generation
- Speech-to-text conversion
- Call status tracking

### 2. **Google Cloud Vertex AI**
- Gemini model integration
- LLM fallback responses
- Model configuration per company
- Token optimization settings

### 3. **OpenAI (Planned)**
- Embedding generation
- Semantic search capabilities
- Enhanced intent classification

### 4. **Vector Database (Planned)**
- Pinecone or Weaviate integration
- Semantic similarity search
- Knowledge base optimization

## 🚨 **Escalation and Safety Routes**

### 1. **Blacklist Enforcement**
- **Service:** `services/agentMonitoring.js`
- **Function:** `checkDisapprovalList()`
- **Action:** Block responses on blacklist, escalate instead

### 2. **Confidence-Based Escalation**
- Threshold-based escalation (configurable per intent)
- Multiple failed response attempts
- Low semantic similarity scores

### 3. **Emergency Detection**
- Emergency keyword patterns
- Urgent priority routing
- Immediate escalation protocols

### 4. **Quality Monitoring**
- Real-time interaction logging
- Human oversight workflow
- Performance tracking and analytics

## 📈 **Performance and Caching**

### 1. **Response Caching**
- In-memory cache for frequent responses
- Cache key: `${companyId}_${normalizedQuery}`
- Cache threshold: confidence >= 0.85

### 2. **Company Data Caching**
- Category Q&As cached in memory
- Company configuration caching
- Session-based caller context

### 3. **Session Management**
- Active call tracking
- Conversation history maintenance
- Context preservation across interactions

## 🔄 **Complete Response Generation Flow**

```
Incoming Call → Company Identification → AI Enabled Check → 
Intelligence Processing → Intent Classification → Response Generation → 
Blacklist Check → Quality Assurance → TwiML Generation → Twilio Response
```

### Parallel Processing
- Monitoring system logs every interaction
- Performance metrics collection
- Error tracking and alerting
- Analytics data gathering

## 📋 **Configuration Points**

### Environment Variables
- `OPENAI_API_KEY` - OpenAI integration
- `GCLOUD_PROJECT_ID` - Google Cloud project
- `MODEL_ID` - Default Gemini model
- `ESCALATION_PHONE` - Human escalation number

### Company-Specific Settings
- AI model selection
- Confidence thresholds
- Escalation preferences
- Custom scripts and protocols

### System-Wide Defaults
- Fuzzy match threshold: 0.15
- Semantic threshold: 0.85
- Cache timeout settings
- Performance targets

---

This comprehensive route map shows that the agent uses **10 distinct data sources** in priority order, with **multiple fallback mechanisms** and **extensive monitoring** to ensure quality responses and human oversight when needed.
