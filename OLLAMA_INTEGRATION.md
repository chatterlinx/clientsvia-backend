# Ollama Local LLM Integration

This integration adds a local Large Language Model (LLM) fallback to your multi-tenant agent platform using Ollama.

## 🎯 **What This Does**

- **Fallback AI**: When your knowledge base doesn't have a good answer (< 70% confidence), the system automatically queries the local LLM
- **Privacy**: All AI processing happens locally on your server - no data sent to external APIs
- **Multi-tenant**: Works with your existing company-specific knowledge base system
- **Seamless**: Integrates with your current `checkCustomKB` workflow

## 📁 **Files Added to Your Project**

```
services/
  └── localLLM.js              # Main Ollama service integration
middleware/
  └── enhancedCustomKB.js      # Enhanced KB with LLM fallback
routes/
  └── llm.js                   # API endpoints for testing/monitoring
test-ollama.js                 # Test script to verify setup
```

## 🔧 **Environment Variables Added**

```env
# Ollama Local LLM Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b-instruct-q4_0
OLLAMA_TIMEOUT=30000
```

## 🚀 **How to Use**

### 1. **Test the Integration** (Do this first)

```bash
# Wait for model download to complete first
ollama list

# Then test the integration
node test-ollama.js
```

### 2. **Replace Your KB Middleware** (In your main agent code)

**Before:**
```javascript
const { checkCustomKB } = require('./middleware/checkCustomKB');
const result = await checkCustomKB(transcript, companyID, traceLogger);
```

**After:**
```javascript
const { enhancedCheckCustomKB } = require('./middleware/enhancedCustomKB');
const result = await enhancedCheckCustomKB(transcript, companyID, traceLogger);
```

### 3. **Add API Routes** (Optional - for testing/monitoring)

In your main `app.js` or `server.js`:

```javascript
const llmRoutes = require('./routes/llm');
app.use('/api/llm', llmRoutes);
```

## 📊 **How It Works**

1. **Customer asks a question** → Your agent receives it
2. **Knowledge Base check** → Searches company + trade category Q&As
3. **If good match found** (≥70% confidence) → Returns KB answer
4. **If poor/no match** → Automatically queries local LLM
5. **LLM generates response** → Using company context for personalization
6. **Returns response** → With source tracking for monitoring

## 🔄 **Response Flow Example**

```
Customer: "What are your emergency service hours?"

1. KB Search: No matches found (0% confidence)
2. LLM Fallback: Activated
3. LLM Context: "Company: ABC Plumbing, Trade: HVAC Repair"
4. LLM Response: "I don't have your specific emergency hours in our system. 
   For urgent HVAC repairs, please call our main number and we'll connect 
   you with our emergency service team who can provide current availability."
```

## 🧪 **Testing Endpoints**

### Check Status
```bash
curl http://localhost:4000/api/llm/status
```

### Test Query
```bash
curl -X POST http://localhost:4000/api/llm/customer-service \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are your hours?",
    "companyId": "your-company-id-here"
  }'
```

## 📈 **Response Structure**

The enhanced KB returns additional fields:

```javascript
{
  answer: "Generated response text",
  confidence: 85,              // LLM responses get 85% confidence
  source: "LLM",              // "KB", "LLM", or "Generic"
  fallbackUsed: true,         // Indicates LLM was used
  originalKBResult: {...},    // Original KB search results
  trace: [...]                // Detailed trace log
}
```

## ⚠️ **Important Notes**

- **Model Download**: Wait for `llama3.1:8b-instruct-q4_0` to finish downloading before testing
- **Performance**: First LLM query may be slower (model loading), subsequent ones are faster
- **Fallback**: If LLM fails, system gracefully falls back to KB result or generic message
- **Privacy**: All processing is local - no external API calls

## 🔍 **Monitoring**

Use the trace logs to monitor KB vs LLM usage:

```javascript
// Example trace output
[
  { source: 'Company Category Q&As', details: 'No matches' },
  { source: 'Trade Category Database', details: 'No matches' },
  { source: 'LLM Fallback Decision', details: 'KB confidence too low (0%), attempting LLM fallback' },
  { source: 'Local LLM Response', details: 'Generated response using llama3.1:8b-instruct-q4_0' }
]
```

## 🎉 **Ready to Deploy**

Once tested locally, this code can be committed to GitHub and deployed to your production server with Ollama installed.

**Remember**: Only the code goes to GitHub, not the Ollama app or models!
