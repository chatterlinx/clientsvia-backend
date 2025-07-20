# AI Agent Response Flow and Data Source Routes

## Overview
This document provides a comprehensive mapping of all routes, data sources, and decision paths the AI agent uses to generate responses to caller queries. The agent follows a sophisticated multi-tier response system with escalation logic.

## Main Entry Points

### 1. Primary Call Handler
**Route:** `/api/ai-agent/incoming-call`  
**File:** `routes/aiAgentHandler.js`  
**Purpose:** Main entry point for all incoming Twilio calls

**Flow:**
1. Extract call data (From, To, SpeechResult, CallSid, CallStatus)
2. Identify company by phone number (`getCompanyByPhoneNumber()`)
3. Check if AI agent is enabled for company
4. Route to intelligent agent system via `RealTimeAgentMiddleware`
5. Generate TwiML response

### 2. Speech Input Handler  
**Route:** `/api/ai-agent/speech-input`  
**File:** `routes/aiAgentHandler.js`  
**Purpose:** Handle ongoing conversation speech input

**Flow:**
1. Get ongoing call session from middleware
2. Process query with intelligent agent
3. Return appropriate TwiML response

### 3. Call Status Handler
**Route:** `/api/ai-agent/call-status`  
**File:** `routes/aiAgentHandler.js`  
**Purpose:** Handle call status updates and cleanup

## Core Agent Processing Pipeline

### Main Processing Engine
**File:** `services/realTimeAgentMiddleware.js`  
**Class:** `RealTimeAgentMiddleware`

**Processing Steps:**
1. **Initialize Call Session** - Get caller context and company config
2. **Process with Intelligence** - Route through SuperIntelligentAgentEngine
3. **Check Escalation Triggers** - Evaluate if human intervention needed
4. **Optimize Response** - Generate final response
5. **Blacklist Check** - Ensure response not on disapproval list
6. **Update Session Context** - Track conversation state
7. **Log Interaction** - Record for monitoring and improvement

### Super-Intelligent Engine
**File:** `services/superIntelligentAgent.js`  
**Class:** `SuperIntelligentAgentEngine`

**Core Functions:**
- `handleQuery()` - Main query processing with semantic search
- `semanticSearch()` - Vector-based knowledge base search
- `generateEmbedding()` - Convert text to embeddings for similarity
- `cosineSimilarity()` - Calculate semantic similarity scores

## Response Generation Routes (Priority Order)

### 1. **HIGHEST PRIORITY: Specific Scenario Protocols**
**Source:** Company document `agentSetup.protocols`  
**Function:** `checkSpecificProtocols()`  
**Confidence:** 0.95  

Checks for exact scenario matches in company-defined protocols.

### 2. **Personality Response Scenarios**
**Source:** `utils/personalityResponses_enhanced.js`  
**Function:** `checkPersonalityScenarios()`  
**Confidence:** 0.85  

Handles common scenarios with personality-driven responses:
- Greetings and pleasantries
- Complaint handling
- Scheduling requests
- General politeness responses

### 3. **Knowledge Base Entries (Approved Q&A)**
**Source:** MongoDB `KnowledgeEntry` collection  
**Function:** Direct database query  
**Confidence:** 0.9  

Searches approved Q&A entries with:
- Company ID match
- Category match (company's trade types)
- Regex pattern matching
- Approved status = true

### 4. **Quick Q&A Reference (Intelligent Matching)**
**Source:** `KnowledgeEntry` collection  
**Function:** `extractQuickAnswerFromQA()`  
**Confidence:** 0.75  

Uses fuzzy matching with configurable threshold (default 0.15):
- Enhanced question processing with keyword extraction
- Levenshtein distance calculation
- Keyword overlap scoring
- Conversational response generation

### 5. **Company Category Q&As**
**Source:** Company document `agentSetup.categoryQAs`  
**Function:** `extractQuickAnswerFromQA()` on cached parsed Q&As  
**Confidence:** 0.8  

Company-specific Q&A content:
- Cached in memory (`categoryQACache`)
- Parsed from text format to structured data
- Fuzzy matching with threshold

### 6. **Smart Conversational Brain**
**Source:** AI-generated responses  
**Function:** `generateSmartConversationalResponse()`  
**Confidence:** 0.7  

Intelligent response generation using:
- Company context
- Conversation history  
- Categories and specialties
- Dynamic reasoning

### 7. **Primary Script Controller**
**Source:** Company document `agentSetup.mainAgentScript`  
**Function:** `processMainAgentScript()`  
**Confidence:** Variable  

Processes the main agent script for:
- Script-based responses
- Template matching
- Placeholder replacement

### 8. **Intelligent Response Generation**
**Source:** AI reasoning with company data  
**Function:** `generateIntelligentResponse()`  
**Confidence:** 0.6  

Last-resort intelligent response using:
- Company Q&As as context
- Categories and specialties
- Conversation history
- AI reasoning capabilities

### 9. **LLM Fallback (if enabled)**
**Source:** Google Vertex AI (Gemini model)  
**Function:** `callModel()`  
**Confidence:** Variable  

Direct LLM call when:
- Company has `llmFallbackEnabled: true`
- All other methods fail
- Uses company-specific model settings

### 10. **Final Escalation**
**Default:** Human escalation message  
**Confidence:** 0  

When all methods fail, escalates to human with:
- Custom escalation message (if configured)
- Default escalation language
- Call transfer to human agent

## Data Sources and Models

### Primary Data Sources

1. **Company Collection** (`companiesCollection`)
   - `aiSettings` - AI configuration and model settings
   - `agentSetup` - Scripts, protocols, categories, placeholders
   - `customQAs` - Legacy Q&A storage
   - `tradeTypes` - Service categories
   - `twilioNumbers` - Phone number mapping

2. **KnowledgeEntry Collection**
   - `companyId` - Company association
   - `question` - Question text
   - `answer` - Answer text
   - `category` - Categorization
   - `keywords` - Search keywords
   - `approved` - Approval status

3. **AgentInteraction Collection** (Monitoring)
   - `companyId` - Company association
   - `callerId` - Caller identification
   - `userQuery` - Original query
   - `agentResponse` - Generated response
   - `confidence` - Response confidence score
   - `responseTime` - Processing time
   - `metadata` - Additional context

4. **AgentApproval/Disapproval Collections** (Monitoring)
   - Blacklist management
   - Response quality tracking
   - Human oversight data

### External Integrations

1. **Twilio** - Voice call handling and TwiML generation
2. **Google Vertex AI** - Gemini model for LLM fallback
3. **OpenAI** - Embeddings and semantic search (planned)
4. **Vector Database** - Semantic similarity (simulated, production ready)

## Intent Classification and Flow Control

### Current Intent Detection Methods

1. **Keyword-Based Classification**
   - Protocol matching with exact keywords
   - Category-based Q&A matching
   - Fuzzy string matching with thresholds

2. **Semantic Classification** (Limited Implementation)
   - Basic embedding similarity in SuperIntelligentAgentEngine
   - Cosine similarity calculations
   - Confidence threshold evaluation (0.85 default)

3. **Enhanced Intent Classification** (Available but not fully integrated)
   - **File:** `enhanced-intent-classification.js`
   - Research-based optimization techniques
   - Better description prefixes and suffixes
   - Improved "None" intent handling
   - Specific pricing question detection

### Escalation Triggers

1. **Confidence-Based Escalation**
   - Response confidence < 0.85 (configurable)
   - Multiple failed response attempts
   - Low semantic similarity scores

2. **Blacklist Escalation**
   - Response matches disapproval list
   - Previously flagged content
   - Compliance violations

3. **Context-Based Escalation**
   - Emergency keywords detected
   - Complaint escalation patterns
   - Complex technical requests

4. **Time-Based Escalation**
   - Long conversation duration
   - Multiple query attempts
   - Repetitive questioning

## Response Optimization Features

### 1. Repetition Detection
- Tracks last 3 agent responses
- Prevents repetitive answers
- Triggers alternative response methods

### 2. Conversation Context
- Maintains session-based memory
- Tracks conversation sentiment
- Builds caller context over time

### 3. Performance Caching
- Response caching for frequent queries
- Company Q&A memory caching
- Session state management

### 4. Quality Assurance
- Monitoring and logging integration
- Human oversight workflow
- Blacklist enforcement
- Performance tracking

## Configuration and Customization

### Company-Level Settings

1. **AI Settings** (`aiSettings`)
   - `enabled` - AI agent on/off
   - `model` - Specific Gemini model
   - `llmFallbackEnabled` - Allow direct LLM calls
   - `customEscalationMessage` - Custom escalation text
   - `fuzzyMatchThreshold` - Q&A matching sensitivity

2. **Agent Setup** (`agentSetup`)
   - `mainAgentScript` - Primary script content
   - `categoryQAs` - Company-specific Q&As
   - `protocols` - Scenario-specific responses
   - `categories` - Service categories
   - `placeholders` - Dynamic content replacement

### System-Level Configuration

1. **Environment Variables**
   - `OPENAI_API_KEY` - OpenAI integration
   - `GCLOUD_PROJECT_ID` - Google Cloud project
   - `MODEL_ID` - Default Gemini model
   - `ESCALATION_PHONE` - Human escalation number

2. **Confidence Thresholds**
   - Semantic search: 0.85
   - Q&A fuzzy matching: 0.15
   - Escalation trigger: 0.7

## Future Enhancement Opportunities

### 1. Intent Classification Improvements
- Integrate enhanced intent classification system
- Implement proper vector database (Pinecone/Weaviate)
- Add industry-specific intent categories
- Develop learning-based classification

### 2. Response Quality Enhancements
- Advanced semantic search capabilities
- Context-aware response generation
- Multi-turn conversation management
- Personalization based on caller history

### 3. Integration Expansions
- CRM system integration
- Scheduling system connectivity
- Real-time knowledge base updates
- Advanced analytics and reporting

### 4. Scalability Improvements
- Multi-tenant architecture enhancements
- Load balancing for high-volume calls
- Distributed caching solutions
- Real-time performance optimization

---

**Last Updated:** January 2025  
**Version:** 1.0  
**Maintained By:** Development Team
