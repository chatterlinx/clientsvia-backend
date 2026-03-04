# Call Intelligence System

## 📋 Overview

The Call Intelligence System provides AI-powered analysis of call performance, automatically detecting trigger matching issues, bucket gaps, and system improvement opportunities.

### Key Features

✅ **GPT-4 Powered Analysis** (Optional, can be toggled on/off)
✅ **Rule-Based Fallback** (Works without GPT-4)
✅ **Enterprise-Grade UI** (Clean, modular, maintainable)
✅ **Copy-Paste Recommendations** (No manual typing required)
✅ **Real-time Insights** (Immediate feedback on call issues)
✅ **Cost Control** (Toggle GPT-4 on/off as needed)

---

## 🏗️ Architecture

```
Backend:
  └── /models/CallIntelligence.js              MongoDB schema
  └── /services/CallIntelligenceService.js     Core business logic
  └── /services/GPT4AnalysisService.js         GPT-4 integration (isolated)
  └── /routes/agentConsole/callIntelligence.js API endpoints
  └── /utils/intelligencePrompts.js            GPT-4 prompts

Frontend:
  └── /public/agent-console/call-intelligence.html
  └── /public/agent-console/call-intelligence.js
  └── /public/agent-console/call-intelligence.css
```

---

## 🚀 Setup

### 1. Install Dependencies

```bash
npm install openai
```

### 2. Configure Environment Variables

Add to `.env`:

```bash
# Optional - only needed for GPT-4 analysis
OPENAI_API_KEY=sk-your-key-here
```

**Note:** System works without GPT-4 using rule-based analysis.

### 3. Register Routes

In your main server file (e.g., `server.js` or `app.js`):

```javascript
const callIntelligenceRoutes = require('./routes/agentConsole/callIntelligence');
app.use('/api/call-intelligence', callIntelligenceRoutes);
```

### 4. Access the Interface

Navigate to:
```
/agent-console/call-intelligence.html?companyId=YOUR_COMPANY_ID
```

---

## 🎯 How It Works

### Analysis Flow

```
Call Completes
    ↓
Trigger Analysis (Manual or Auto)
    ↓
GPT-4 Enabled? ──→ YES ──→ GPT-4 Analysis
    |                          ↓
    NO                    Structured JSON
    ↓                          ↓
Rule-Based Analysis    Store in Database
    ↓                          ↓
Store in Database      Display in UI
    ↓
Display in UI
```

### Analysis Modes

**Quick Mode:**
- Faster processing
- Less detailed
- ~$0.01 per call
- Best for: Batch analysis

**Full Mode:**
- Comprehensive analysis
- Detailed recommendations
- ~$0.03-0.05 per call
- Best for: Critical issue investigation

---

## 📊 Data Model

### CallIntelligence Schema

```javascript
{
  callSid: String,
  companyId: String,
  status: 'critical' | 'needs_improvement' | 'performing_well',
  executiveSummary: String,
  topIssue: String,
  
  issues: [{
    severity: 'critical' | 'high' | 'medium' | 'low',
    category: String,
    title: String,
    description: String,
    evidence: Object
  }],
  
  recommendations: [{
    priority: 'immediate' | 'high' | 'medium' | 'low',
    type: String,
    title: String,
    description: String,
    copyableContent: String,
    status: 'pending' | 'implemented' | 'dismissed'
  }],
  
  analysis: {
    triggerAnalysis: {...},
    scrabEnginePerformance: {...},
    callFlowAnalysis: {...}
  },
  
  gpt4Analysis: {
    enabled: Boolean,
    tokensUsed: Number,
    processingTime: Number
  }
}
```

---

## 🔌 API Endpoints

### Get GPT-4 Status
```http
GET /api/call-intelligence/status
```

### Toggle GPT-4
```http
POST /api/call-intelligence/toggle
Body: { "enabled": true }
```

### Analyze Call
```http
POST /api/call-intelligence/analyze/:callSid
Body: {
  "useGPT4": false,
  "mode": "full",
  "forceReanalyze": false
}
```

### Get Call Intelligence
```http
GET /api/call-intelligence/:callSid
```

### Get Company Summary
```http
GET /api/call-intelligence/company/:companyId/summary?timeRange=today
```

### Get Intelligence List
```http
GET /api/call-intelligence/company/:companyId/list?page=1&limit=50&status=critical
```

### Mark Recommendation Implemented
```http
POST /api/call-intelligence/:callSid/recommendation/:recommendationId/implement
Body: { "implementedBy": "admin@example.com" }
```

### Batch Analyze
```http
POST /api/call-intelligence/batch-analyze
Body: {
  "callSids": ["CA123...", "CA456..."],
  "useGPT4": true,
  "mode": "quick"
}
```

### Estimate Cost
```http
GET /api/call-intelligence/estimate-cost?callCount=100&mode=full
```

---

## 💰 Cost Management

### GPT-4 Pricing (as of 2024)

- **Quick Mode:** ~$0.01-0.02 per call
- **Full Mode:** ~$0.03-0.05 per call

### Cost Control Features

1. **Toggle On/Off:** Disable GPT-4 when not needed
2. **Batch Analysis:** Analyze multiple calls efficiently
3. **Cost Estimator:** Preview costs before analyzing
4. **Rule-Based Fallback:** Zero-cost analysis option

### Example Monthly Costs

| Calls/Day | Mode  | Cost/Month |
|-----------|-------|------------|
| 10        | Full  | $15        |
| 50        | Full  | $75        |
| 100       | Quick | $60        |
| 100       | Full  | $150       |

---

## 🎨 UI Components

### Main Table View

- **Stats Banner:** Quick overview of call performance
- **Filters:** Search, status, time range
- **Intelligence Column:** Compact status with top issue
- **Pagination:** Navigate through calls

### Analysis Modal (Full Page)

1. **Call Overview:** Basic call metadata
2. **Executive Summary:** High-level what/why
3. **Trigger Analysis:** Why triggers didn't match
4. **Issues:** Detailed problem breakdown
5. **ScrabEngine Performance:** Processing analysis
6. **Recommendations:** Copy-paste solutions
7. **Performance Metrics:** Response times
8. **Raw Data Access:** Download JSON, open in Call Console

### Settings Modal

- **GPT-4 Toggle:** Enable/disable AI analysis
- **Analysis Mode:** Quick vs Full
- **Status Indicator:** Current configuration

---

## 🔍 Analysis Types

### Trigger Matching Issues

**Detects:**
- Missing keywords/phrases
- Conversational patterns not captured
- Token mismatches

**Recommendations:**
- Exact keywords to add
- Trigger improvements
- New trigger suggestions

### Bucket Gaps

**Detects:**
- No bucket matched
- Wrong bucket assigned
- Low confidence classification

**Recommendations:**
- Bucket configuration updates
- Classification keyword additions

### ScrabEngine Performance

**Detects:**
- Normalization failures
- Quality gate issues
- Token expansion problems

**Recommendations:**
- Vocabulary updates
- Synonym improvements

### Response Quality

**Detects:**
- Inappropriate fallback usage
- Generic responses
- Poor caller experience

**Recommendations:**
- Response improvements
- Better trigger matching

---

## 🛠️ Debugging

### Enable Debug Logging

```javascript
// In GPT4AnalysisService.js
console.log('GPT-4 Request:', userPrompt);
console.log('GPT-4 Response:', responseText);
```

### Check GPT-4 Status

```bash
curl http://localhost:3000/api/call-intelligence/status
```

### Analyze Specific Call

```bash
curl -X POST http://localhost:3000/api/call-intelligence/analyze/CA123... \
  -H "Content-Type: application/json" \
  -d '{"useGPT4": true, "mode": "full"}'
```

### View Analysis in Database

```javascript
db.call_intelligence.find({ callSid: "CA123..." }).pretty()
```

---

## ⚙️ Configuration

### Customize GPT-4 Model

In `GPT4AnalysisService.js`:

```javascript
this.modelVersion = 'gpt-4-turbo-preview'; // or 'gpt-4', 'gpt-4o', etc.
this.maxTokens = 4000;
this.temperature = 0.3; // Lower = more consistent
```

### Customize Analysis Prompts

Edit `/utils/intelligencePrompts.js` to modify:
- System prompt
- Analysis focus areas
- Output structure

### Customize UI Theme

Edit `/public/agent-console/call-intelligence.css`:
- Color scheme
- Spacing
- Typography

---

## 🔒 Security

### Best Practices

1. **API Key Protection:**
   - Never commit `.env` file
   - Use environment variables only
   - Rotate keys regularly

2. **Access Control:**
   - Add authentication middleware to routes
   - Restrict access by company ID
   - Log all analysis requests

3. **Data Privacy:**
   - Analysis contains call transcripts
   - Implement data retention policies
   - Consider GDPR/privacy requirements

### Example Auth Middleware

```javascript
router.use(async (req, res, next) => {
  // Verify user has access to company
  const { companyId } = req.params;
  if (!await userHasAccess(req.user, companyId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
```

---

## 📈 Performance

### Optimization Tips

1. **Database Indexes:**
   - Already created on `callSid`, `companyId`, `status`, `analyzedAt`

2. **Batch Processing:**
   - Use batch analyze for multiple calls
   - Set `maxConcurrent: 3` to avoid rate limits

3. **Caching:**
   - Store analysis results in database
   - Don't re-analyze unless forced

4. **Pagination:**
   - Default limit: 50 calls per page
   - Adjust based on performance

### Expected Performance

- **Rule-Based Analysis:** <50ms per call
- **GPT-4 Quick Mode:** 1-3 seconds per call
- **GPT-4 Full Mode:** 3-8 seconds per call
- **Database Query:** <100ms

---

## 🧪 Testing

### Test GPT-4 Integration

```javascript
const GPT4AnalysisService = require('./services/GPT4AnalysisService');

const testCall = { /* call trace data */ };
const result = await GPT4AnalysisService.analyzeCall(testCall, { mode: 'quick' });
console.log(result);
```

### Test Rule-Based Analysis

```javascript
const CallIntelligenceService = require('./services/CallIntelligenceService');

const analysis = await CallIntelligenceService.analyzeCall(testCall, { useGPT4: false });
console.log(analysis);
```

---

## 📝 Changelog

### v1.0.0 (March 2026)

- ✅ Initial release
- ✅ GPT-4 integration with toggle
- ✅ Rule-based fallback
- ✅ Enterprise UI
- ✅ Copy-paste recommendations
- ✅ Batch analysis
- ✅ Cost estimation

---

## 🤝 Contributing

### Code Standards

1. **Modularity:** Keep services isolated
2. **Labeling:** Clear function/variable names
3. **Comments:** Explain "why", not "what"
4. **Error Handling:** Always catch and log errors
5. **No Spaghetti:** Maintain clean separation of concerns

### File Organization

- **Models:** Database schemas only
- **Services:** Business logic (stateless)
- **Routes:** API endpoints (thin controllers)
- **Utils:** Helper functions (pure)
- **Public:** Frontend files (HTML/CSS/JS)

---

## 📧 Support

For issues or questions:
1. Check this README first
2. Review console logs for errors
3. Test with rule-based analysis first
4. Verify GPT-4 API key if using AI mode

---

## 📄 License

Proprietary - ClientsVia Internal Use Only
