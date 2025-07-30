# 🚨 AI Agent Quick Troubleshooting Guide

## Common Issues & Instant Fixes

### 🤖 "I can help you with that" (Generic Responses)

**Quick Diagnosis:**
```bash
# Check if AI is actually processing
grep "AI Intelligence" logs/combined.log | tail -5

# Check knowledge base
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "http://localhost:5001/api/company/companies/COMPANY_ID"
```

**Instant Fixes:**
1. **Lower Confidence Threshold** → 0.3-0.4
2. **Add Company Q&As** → Company Profile → Category Q&A
3. **Check LLM Status** → AI Intelligence Settings → LLM Status
4. **Switch to Gemini Pro** → More intelligent responses

---

### 📈 Too Many Escalations (>20%)

**Quick Diagnosis:**
```bash
# Check escalation rate
grep "escalation" logs/combined.log | tail -10
```

**Instant Fixes:**
1. **Lower Fallback Threshold** → 0.4-0.5
2. **Switch Escalation Mode** → "Auto" to "Ask"  
3. **Add Trade Category Q&As** → Trade Category Management
4. **Enable Semantic Search** → AI Intelligence Settings

---

### 🐌 Slow Response Times (>3 seconds)

**Quick Diagnosis:**
```bash
# Check response times
grep "response generated in" logs/combined.log | tail -5
```

**Instant Fixes:**
1. **Switch to Local LLM** → Ollama Phi-3
2. **Reduce Context Retention** → 30 minutes max
3. **Disable Memory Mode** → Set to "Short"
4. **Check Network** → Local LLMs are faster

---

### ❌ Inaccurate Responses

**Quick Diagnosis:**
- Check if auto-learning is too aggressive
- Review recent learning queue items

**Instant Fixes:**
1. **Increase Confidence Threshold** → 0.7-0.8
2. **Manual Learning Approval** → Disable auto-approve
3. **Review Knowledge Base** → Remove outdated Q&As
4. **Test Queries** → Use built-in test panel

---

## Emergency Fixes

### 🔥 AI Agent Completely Down
```javascript
// Emergency fallback settings
{
  useLLM: false,
  fallbackThreshold: 0.1,
  escalationMode: 'auto'
}
```

### 🔥 All LLMs Failing
1. Check if Ollama is running: `curl http://localhost:11434/api/tags`
2. Check Google Cloud credentials
3. Enable basic Q&A matching only

### 🔥 High Error Rate
```bash
# Quick log check
tail -50 logs/error.log | grep "AI"

# Reset to safe defaults
curl -X PUT "http://localhost:5001/api/company/companies/COMPANY_ID" \
     -H "Content-Type: application/json" \
     -d '{"agentIntelligenceSettings": {"fallbackThreshold": 0.8, "escalationMode": "ask"}}'
```

---

## Performance Targets

| Metric | Target | Action if Off-Target |
|--------|--------|---------------------|
| Confidence Rate | >85% | Lower threshold or improve knowledge |
| Response Time | <2s | Use local LLMs or optimize queries |
| Escalation Rate | <15% | Lower threshold or add Q&As |
| Learning Queue | <50 items | Regular approval/rejection |

---

## Quick Settings for Common Scenarios

### Conservative (High Accuracy)
```javascript
{
  fallbackThreshold: 0.8,
  escalationMode: 'ask',
  primaryLLM: 'gemini-pro',
  learningApprovalMode: 'manual'
}
```

### Balanced (Recommended)
```javascript
{
  fallbackThreshold: 0.5,
  escalationMode: 'ask', 
  primaryLLM: 'ollama-phi3',
  learningApprovalMode: 'auto-high-confidence'
}
```

### Aggressive (High Automation)
```javascript
{
  fallbackThreshold: 0.3,
  escalationMode: 'auto',
  primaryLLM: 'ollama-phi3',
  realTimeOptimization: true
}
```

---

## Health Check Commands

```bash
# Check server status
curl http://localhost:5001/health

# Check Ollama connection  
curl http://localhost:11434/api/tags

# Check Redis connection
redis-cli ping

# Check MongoDB connection
mongosh --eval "db.companiesCollection.countDocuments()"

# Check AI processing
grep "AI response generated" logs/combined.log | tail -1
```

---

## Immediate Actions by Symptom

| Symptom | Immediate Action |
|---------|------------------|
| Generic responses | Add 10+ company Q&As, lower threshold to 0.4 |
| Too many escalations | Lower threshold to 0.4, add trade Q&As |
| Slow responses | Switch to Ollama Phi-3, reduce memory mode |
| Wrong information | Increase threshold to 0.7, review knowledge base |
| No responses | Check LLM status, restart Ollama if needed |
| High CPU usage | Reduce context retention, use lighter LLM model |

---

## 5-Minute Setup for New Company

1. **Add Company** → Basic info + phone number
2. **Add 10 Core Q&As** → Hours, location, services, pricing
3. **Set Conservative Settings** → Threshold 0.7, Ask mode
4. **Test 5 Common Questions** → Use test panel
5. **Monitor First 10 Calls** → Adjust threshold based on escalation rate

---

## Emergency Contacts & Resources

- **Server Logs**: `/logs/combined.log`
- **AI Intelligence Settings**: `/ai-agent-intelligence.html`
- **Company Management**: `/directory.html`
- **Test Interface**: Built into AI Intelligence Settings
- **Full Documentation**: `/docs/ai-agent-intelligence-guide.md`

## Pro Tips 💡

1. **Start Conservative** → It's easier to lower thresholds than fix bad responses
2. **Monitor Weekly** → Check performance metrics and adjust
3. **Test Everything** → Use the test panel before going live
4. **Keep Knowledge Current** → Outdated Q&As hurt performance
5. **Local First** → Use Ollama for speed, cloud for complexity
