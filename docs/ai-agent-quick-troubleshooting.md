# AI Agent Quick Troubleshooting Guide

## 🚨 Emergency Quick Fixes

### 1. Agent Not Responding
**Symptoms**: No replies to SMS or voice calls
**Quick Fix**:
1. Check company settings → Enable AI Agent
2. Verify LLM model is set to `gemini-pro`
3. Check Twilio webhook configuration

### 2. Poor Response Quality
**Symptoms**: Generic or incorrect answers
**Quick Fix**:
1. **Switch to Premium LLM** → GPT-4 or Claude-3
2. **Update Knowledge Base** → Add company-specific Q&As
3. **Adjust confidence threshold** → Lower to 0.3 for more responses

### 3. Agent Too Slow
**Symptoms**: Long delays before responses
**Quick Fix**:
1. **Switch to Cloud LLM** → Gemini Pro
2. **Reduce conversation memory** → Set to "short term"
3. **Simplify prompts** → Remove complex instructions

### 4. Agent Escalates Too Much
**Symptoms**: "Let me transfer you" for simple questions
**Quick Fix**:
1. **Lower escalation threshold** → 0.3 or 0.4
2. **Add more Q&As** → Cover common questions
3. **Enable semantic search** → Better knowledge matching

## 🔧 Advanced Diagnostics

### Check Cloud LLM Connection
```bash
curl -X POST https://your-server.com/api/health
```

### Test Company Configuration
```javascript
// Test company AI settings
const testConfig = {
  primaryLLM: 'gemini-pro',
  fallbackLLM: 'openai-gpt4',
  confidenceThreshold: 0.4,
  escalationMode: 'ask'
};
```

### Validate Knowledge Base
```javascript
// Test knowledge base lookup
const testKB = {
  question: "What are your business hours?",
  expectedAnswer: "We're open Monday-Friday 9am-5pm",
  primaryLLM: 'gemini-pro',
  fallbackEnabled: true
};
```

## 📊 Performance Optimization

### Response Time Targets
- **Excellent**: < 2 seconds
- **Good**: 2-5 seconds  
- **Needs Work**: > 5 seconds

### Quality Metrics
| Issue | Solution |
|-------|----------|
| Generic responses | Add specific company Q&As |
| Slow responses | Switch to Cloud LLM, reduce memory mode |
| Too many escalations | Lower confidence threshold |
| No responses | Check LLM status, restart cloud services if needed |
| Knowledge gaps | Expand Q&A database |

## 🎯 Best Practices

1. **Knowledge First** → Build comprehensive Q&A database
2. **Cloud Reliable** → Use cloud LLMs for production
3. **Monitor Performance** → Track response times and quality
4. **Regular Updates** → Keep knowledge base current
5. **Cloud First** → Use cloud infrastructure for speed, local for complexity

## 🆘 Emergency Contacts

- **Tech Support**: support@clientsvia.com
- **Emergency Line**: 1-800-CLIENTS
- **Status Page**: status.clientsvia.com
