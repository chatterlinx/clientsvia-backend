# 🧠 AI Agent Intelligence Architecture & Settings Guide

## Table of Contents
1. [Overview](#overview)
2. [AI Agent Processing Flow](#ai-agent-processing-flow)
3. [Intelligence Settings Explained](#intelligence-settings-explained)
4. [LLM & Processing Engine](#llm--processing-engine)
5. [Memory & Context Management](#memory--context-management)
6. [Confidence & Escalation Logic](#confidence--escalation-logic)
7. [Learning & Knowledge Sources](#learning--knowledge-sources)
8. [Performance Monitoring](#performance-monitoring)
9. [Troubleshooting Common Issues](#troubleshooting-common-issues)
10. [Best Practices](#best-practices)

---

## Overview

The ClientsVia AI Agent is a sophisticated multi-layered intelligence system that processes incoming calls through multiple AI engines, knowledge sources, and decision-making frameworks. This guide explains how the system works and how to fine-tune every aspect of its behavior.

### Key Components:
- **Primary Processing Engine**: Multi-LLM system with local and cloud fallbacks
- **Knowledge Management**: Company Q&A, Trade Categories, Vector Search
- **Intelligence Engine**: Contextual memory, dynamic reasoning, smart escalation
- **Performance Monitoring**: Real-time metrics and optimization
- **Learning System**: Auto-learning with approval workflows

---

## AI Agent Processing Flow

Here's how a customer call is processed through the AI system:

```
📞 Incoming Call
    ↓
1. 🎯 Company Identification (by phone number)
    ↓
2. ⚙️ Load Company Settings (agentIntelligenceSettings + aiSettings)
    ↓
3. 🎙️ Speech Recognition (Twilio → SpeechResult)
    ↓
4. 🔍 Knowledge Source Priority Check:
   a) Company Q&A (Priority 1)
   b) Trade Category Q&A (Priority 2) 
   c) AI Intelligence Engine (Priority 3)
   d) LLM Fallback (Priority 4)
    ↓
5. 🧠 AI Intelligence Processing:
   - Contextual Memory Retrieval
   - Semantic Knowledge Search
   - Dynamic Reasoning (ReAct Framework)
   - Smart Escalation Detection
    ↓
6. 🎯 Confidence Scoring & Threshold Check
    ↓
7. 🔄 Response Generation:
   - Primary LLM (e.g., Ollama Phi-3)
   - Fallback LLM (e.g., Gemini Pro)
   - Emergency Fallback (Basic Q&A)
    ↓
8. 📊 Performance Tracking & Learning Queue
    ↓
9. 🔊 TTS Generation (ElevenLabs/Google)
    ↓
10. 📞 Response to Customer
```

---

## Intelligence Settings Explained

### Primary Settings Location
All AI agent settings are stored in the Company MongoDB document under two main sections:

#### `agentIntelligenceSettings` (New Enterprise Features)
```javascript
{
  useLLM: true,                    // Enable/disable LLM processing
  primaryLLM: 'ollama-phi3',       // Main AI model
  fallbackLLM: 'gemini-pro',       // Backup AI model
  memoryMode: 'conversation',      // short|conversation|session
  fallbackThreshold: 0.5,          // Confidence threshold (0-1)
  escalationMode: 'ask',           // ask|auto
  rePromptAfterTurns: 3,          // Re-engage attempts
  maxPromptsPerCall: 2,           // Maximum prompts per call
  semanticSearchEnabled: true,     // Enable semantic search
  confidenceScoring: true,         // Enable confidence scoring
  autoLearningQueue: true,         // Enable learning queue
  // ... more settings
}
```

#### `aiSettings` (Legacy + Advanced Features)
```javascript
{
  customEscalationMessage: "Let me connect you...",
  sentimentAnalysis: false,
  contextualMemory: {
    enabled: true,
    memoryRetentionHours: 24
  },
  dynamicReasoning: { enabled: true },
  smartEscalation: { enabled: true },
  continuousLearning: {
    realTimeOptimization: true,
    predictiveIntentAnalysis: false,
    abTestStrategies: false
  },
  performanceBenchmarks: {
    targetConfidenceRate: 0.87,
    targetResponseTime: 1.8,
    targetEscalationRate: 0.12
  }
}
```

---

## LLM & Processing Engine

### Available LLM Models

#### Local Models (Privacy-First)
- **Ollama Phi-3**: Fast, efficient, runs locally. Best for general inquiries.
- **Ollama Mistral**: Balanced performance, more complex reasoning.

#### Cloud Models (High Performance)
- **Gemini Pro**: Google's powerful model, excellent for complex reasoning.
- **OpenAI GPT-4**: Premium model with advanced capabilities.
- **Claude-3**: Anthropic's advanced model with strong safety features.

### Processing Hierarchy

1. **Primary LLM**: First choice for processing queries
2. **Fallback LLM**: Used when primary fails or is unavailable  
3. **Emergency Fallback**: Basic Q&A matching when all LLMs fail

### Configuration Tips

**For High Privacy Requirements**:
```javascript
primaryLLM: 'ollama-phi3',
fallbackLLM: 'ollama-mistral',
useLLM: true
```

**For Maximum Performance**:
```javascript
primaryLLM: 'gemini-pro',
fallbackLLM: 'openai-gpt4',
useLLM: true
```

**For Cost-Conscious Setup**:
```javascript
primaryLLM: 'ollama-phi3',
fallbackLLM: 'gemini-pro',
useLLM: true
```

---

## Memory & Context Management

### Memory Modes

#### Short Term (`memoryMode: 'short'`)
- No conversation history
- Each query processed independently
- Fastest processing, lowest context
- Best for: Simple Q&A services

#### Conversation (`memoryMode: 'conversation'`)
- Remembers entire call conversation
- Context maintained throughout call
- Moderate processing overhead
- Best for: Complex service discussions

#### Session (`memoryMode: 'session'`)
- Cross-call memory and personalization
- Remembers caller preferences
- Highest processing overhead
- Best for: Recurring customer relationships

### Context Retention Settings

```javascript
contextualMemory: {
  enabled: true,
  memoryRetentionHours: 24    // How long to remember caller context
}
```

**Recommended Settings**:
- **HVAC/Plumbing**: 24-48 hours (service follow-ups common)
- **Restaurants**: 2-4 hours (same-day reservations)
- **Professional Services**: 72 hours (project discussions)

---

## Confidence & Escalation Logic

### Fallback Threshold (`fallbackThreshold`)

This is the **most important setting** for controlling agent behavior:

- **0.8-1.0 (Conservative)**: Only answers when very confident
- **0.5-0.7 (Balanced)**: Moderate confidence required
- **0.0-0.4 (Aggressive)**: Will attempt most questions

### Escalation Modes

#### Ask Mode (`escalationMode: 'ask'`)
```
AI: "I want to make sure I give you accurate information. 
     Would you like me to connect you with a specialist?"
```

#### Auto Mode (`escalationMode: 'auto'`)
```
AI: "Let me connect you with one of our specialists 
     who can better help you with that."
```

### Response Limits

- **rePromptAfterTurns**: How many conversation turns before re-engaging
- **maxPromptsPerCall**: Maximum re-engagement attempts per call

### Custom Escalation Messages

Personalize escalation messages for your brand:
```javascript
customEscalationMessage: "I want to make sure you get the exact information you need. Let me connect you with our [TRADE TYPE] specialist who can provide detailed assistance."
```

---

## Learning & Knowledge Sources

### Knowledge Source Priority

The AI agent checks knowledge sources in this order:

1. **Company Q&A** (Priority 1)
   - Custom company-specific questions and answers
   - Highest confidence and relevance
   - Managed via Company Profile → Category Q&A Management

2. **Trade Category Q&A** (Priority 2)
   - Industry-specific knowledge base
   - Shared across companies in same trade
   - Managed via Trade Category Management

3. **Vector Search** (Priority 3)
   - Semantic search through knowledge base
   - AI-powered similarity matching

4. **LLM Fallback** (Priority 4)
   - Dynamic AI reasoning when no knowledge match found
   - Uses primary/fallback LLM models

### Auto-Learning Configuration

#### Learning Approval Modes

**Manual Approval** (`learningApprovalMode: 'manual'`)
- All learning suggestions require human review
- Safest option for regulated industries
- Admin reviews via Learning Management interface

**Auto-Approve High Confidence** (`learningApprovalMode: 'auto-high-confidence'`)
- Automatically approves learning above threshold
- Faster knowledge base growth
- Requires careful threshold tuning

**Learning Disabled** (`learningApprovalMode: 'disabled'`)
- No automatic learning
- Static knowledge base only

#### Learning Confidence Threshold

```javascript
learningConfidenceThreshold: 0.85    // Only learn from high-confidence interactions
```

**Recommended Thresholds**:
- **Conservative**: 0.9-1.0 (only learn from perfect matches)
- **Balanced**: 0.8-0.9 (learn from good matches)
- **Aggressive**: 0.7-0.8 (learn from decent matches)

---

## Performance Monitoring

### Key Metrics

#### Confidence Rate
- **Target**: 87%+ of responses should meet confidence threshold
- **Too Low**: Lower fallback threshold or improve knowledge base
- **Too High**: May be missing opportunities to help customers

#### Response Time
- **Target**: <1.8 seconds average
- **Factors**: LLM choice, knowledge base size, complexity
- **Optimization**: Use local LLMs for speed, cloud for accuracy

#### Escalation Rate  
- **Target**: <12% of calls escalated
- **Too High**: Lower confidence thresholds, improve knowledge base
- **Too Low**: May be giving inaccurate information

### Real-Time Optimization

```javascript
continuousLearning: {
  realTimeOptimization: true,     // Adjust thresholds based on performance
  predictiveIntentAnalysis: true, // Predict customer intent
  abTestStrategies: false         // A/B test different approaches
}
```

---

## Troubleshooting Common Issues

### Issue: "I can help you with that" Generic Responses

**Symptoms**: AI gives vague responses instead of specific answers

**Causes & Solutions**:

1. **Empty Knowledge Base**
   - **Check**: Company Profile → Category Q&A Management
   - **Fix**: Add specific Q&As for your services

2. **Low Confidence Threshold**
   - **Check**: AI Intelligence Settings → Fallback Confidence Threshold
   - **Fix**: Lower threshold to 0.3-0.4 for more responses

3. **Wrong LLM Model**
   - **Check**: Primary LLM selection
   - **Fix**: Try Gemini Pro or OpenAI GPT-4 for better reasoning

4. **Insufficient Context**
   - **Check**: Memory Mode setting
   - **Fix**: Use 'conversation' mode for call context

### Issue: Too Many Escalations

**Symptoms**: AI escalates most calls instead of answering

**Causes & Solutions**:

1. **High Confidence Threshold**
   - **Check**: Fallback Confidence Threshold
   - **Fix**: Lower to 0.4-0.6

2. **Missing Trade Category Q&A**
   - **Check**: Trade Category Management
   - **Fix**: Add industry-specific Q&As

3. **LLM Not Available**
   - **Check**: LLM Status in settings
   - **Fix**: Ensure Ollama is running or cloud APIs configured

### Issue: Slow Response Times

**Symptoms**: Long delays before AI responds

**Causes & Solutions**:

1. **Cloud LLM Latency**
   - **Check**: Primary LLM setting
   - **Fix**: Switch to local Ollama models

2. **Large Knowledge Base**
   - **Check**: Vector search enabled with large Q&A sets
   - **Fix**: Optimize knowledge base, remove duplicates

3. **High Memory Retention**
   - **Check**: Context retention hours
   - **Fix**: Reduce to 4-12 hours if not needed

### Issue: Inaccurate Responses

**Symptoms**: AI gives wrong information

**Causes & Solutions**:

1. **Low Confidence Threshold**
   - **Check**: Fallback threshold setting
   - **Fix**: Increase to 0.6-0.8

2. **Auto-Learning Too Aggressive**
   - **Check**: Learning confidence threshold
   - **Fix**: Increase to 0.9+ or use manual approval

3. **Outdated Knowledge Base**
   - **Check**: Company Q&As and trade categories
   - **Fix**: Review and update information

---

## Best Practices

### Initial Setup (New Company)

1. **Start Conservative**:
   ```javascript
   fallbackThreshold: 0.7,
   escalationMode: 'ask',
   learningApprovalMode: 'manual'
   ```

2. **Build Knowledge Base**:
   - Add 20-30 core company Q&As
   - Configure trade category Q&As
   - Test with common customer questions

3. **Monitor & Adjust**:
   - Review escalation rate after 1 week
   - Lower threshold if too many escalations
   - Check learning queue for new Q&As

### Production Optimization

1. **Weekly Review**:
   - Check performance metrics
   - Review learning queue
   - Update knowledge base

2. **Monthly Tuning**:
   - Analyze confidence rates
   - Adjust thresholds based on patterns
   - Update escalation messages

3. **Quarterly Assessment**:
   - Review LLM model performance
   - Consider upgrading to newer models
   - Evaluate advanced features

### Industry-Specific Recommendations

#### HVAC/Plumbing
```javascript
fallbackThreshold: 0.5,          // Technical questions vary widely
memoryMode: 'conversation',      // Complex service discussions
targetEscalationRate: 0.15,      // Higher due to technical complexity
contextRetention: 48             // Service follow-ups common
```

#### Restaurants/Food Service
```javascript
fallbackThreshold: 0.4,          // Simple menu/hours questions
memoryMode: 'short',             // Quick interactions
targetEscalationRate: 0.08,      // Lower complexity
contextRetention: 4              // Same-day interactions only
```

#### Professional Services
```javascript
fallbackThreshold: 0.6,          // Accuracy critical
memoryMode: 'session',           // Client relationships
targetEscalationRate: 0.10,      // Moderate complexity
contextRetention: 72             // Project discussions span days
```

### Security & Privacy Considerations

1. **Local LLM Priority**: Use Ollama models for sensitive industries
2. **Memory Retention**: Limit to business needs only
3. **Learning Approval**: Use manual approval for regulated industries
4. **Escalation Messages**: Avoid revealing system architecture

### Performance Optimization

1. **LLM Selection**: Balance speed vs. accuracy for your use case
2. **Knowledge Base**: Keep Q&As concise and well-organized
3. **Thresholds**: Start conservative, optimize based on real data
4. **Monitoring**: Set up alerts for performance degradation

---

## Access the AI Intelligence Settings

1. **Navigate to**: `/ai-agent-intelligence.html`
2. **Select Company**: Choose from dropdown
3. **Configure Settings**: Adjust all parameters
4. **Test Changes**: Use built-in test panel
5. **Save Settings**: Changes take effect immediately

The interface provides real-time validation, preset configurations, and the ability to export/import settings for backup or replication across companies.

---

## Support & Advanced Configuration

For advanced configurations or troubleshooting beyond this guide:

1. **Check Server Logs**: Look for AI processing errors
2. **Monitor Performance**: Use built-in performance dashboard  
3. **Test Configurations**: Use AI test panel before going live
4. **Review Learning Queue**: Regularly approve/reject learning suggestions

Remember: The AI agent learns and improves over time. Start with conservative settings and gradually optimize based on real customer interactions and performance metrics.
