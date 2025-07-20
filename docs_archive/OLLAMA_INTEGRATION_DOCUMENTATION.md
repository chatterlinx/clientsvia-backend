# Ollama Integration Documentation

## Overview

This document describes the integration of Ollama (local LLM) into the ClientsVia Agent Platform as an intelligent fallback system when the custom knowledge base doesn't have sufficient answers.

## Architecture

```
Customer Question
       ↓
1. Service Issue Detection
       ↓
2. Custom Knowledge Base Check
       ↓ (if no good match)
3. Ollama LLM Fallback ← NEW
       ↓ (if Ollama fails)
4. AI Intelligence Engine
       ↓ (if no match)
5. Cloud API Fallback
```

## Files Created/Modified

### New Files
- **`services/ollamaService.js`** - Core Ollama integration service
- **`middleware/checkKBWithOllama.js`** - Enhanced KB middleware with Ollama fallback
- **`routes/ollama.js`** - API endpoints for monitoring/testing
- **`test-ollama-integration.js`** - Comprehensive test suite

### Modified Files
- **`services/agent.js`** - Integrated Ollama fallback into main agent flow
- **`app.js`** - Added Ollama API routes
- **`.env`** - Added Ollama configuration variables

## Configuration

### Environment Variables

```bash
# Ollama Local LLM Configuration
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_TIMEOUT=30000
OLLAMA_FALLBACK_ENABLED=true
OLLAMA_CONFIDENCE_THRESHOLD=0.7
```

### Per-Company Configuration

Companies can enable/disable Ollama fallback in their AI settings:

```javascript
// In company document
aiSettings: {
  ollamaFallbackEnabled: true,  // Enable/disable Ollama for this company
  personality: "friendly and professional",
  // ... other settings
}
```

## Installation & Setup

### 1. Install Ollama

**macOS:**
```bash
# Download and install from https://ollama.ai
# OR using Homebrew:
brew install ollama
```

**Linux/Windows:**
```bash
# Follow instructions at https://ollama.ai
```

### 2. Download Models

```bash
# Start Ollama service
ollama serve

# Download recommended model (in another terminal)
ollama pull llama3.2:3b

# Alternative models:
# ollama pull llama3.1:8b-instruct-q4_0  # Larger, more capable
# ollama pull llama3.2:1b                # Smaller, faster
```

### 3. Test Installation

```bash
# Test Ollama directly
ollama run llama3.2:3b

# Test through your application
node test-ollama-integration.js
```

## API Endpoints

All endpoints are prefixed with `/api/ollama`:

### GET `/status`
Check Ollama service health and configuration.

**Response:**
```json
{
  "timestamp": "2025-01-19T...",
  "service": {
    "available": true,
    "url": "http://localhost:11434",
    "configured_model": "llama3.2:3b",
    "timeout": 30000
  },
  "connection": {
    "success": true,
    "available_models": [...],
    "test_generation_success": true
  },
  "environment": {
    "ollama_fallback_enabled": true,
    "confidence_threshold": 0.7
  }
}
```

### POST `/test`
Test basic text generation.

**Request:**
```json
{
  "prompt": "What is HVAC?",
  "options": {
    "temperature": 0.3,
    "max_tokens": 100
  }
}
```

### POST `/agent-test`
Test agent-specific response generation.

**Request:**
```json
{
  "question": "My AC is making noise",
  "company_name": "CoolAir HVAC",
  "trade_category": "hvac-residential",
  "personality": "professional and helpful"
}
```

### POST `/kb-fallback-test`
Test the complete KB + Ollama fallback flow.

**Request:**
```json
{
  "question": "How often should I change my air filter?",
  "company_id": "test-company",
  "fallback_enabled": true
}
```

### GET `/run-tests`
Run the complete integration test suite.

### GET `/models`
List all available Ollama models.

## Usage Examples

### 1. Basic Ollama Service Usage

```javascript
const ollamaService = require('./services/ollamaService');

// Generate a basic response
const result = await ollamaService.generateResponse("What is HVAC?");
if (result.success) {
  console.log(result.text);
}

// Generate an agent-specific response
const agentResult = await ollamaService.generateAgentResponse(
  "My furnace won't start",
  {
    companyName: "WarmHome Heating",
    tradeCategory: "hvac-residential",
    personality: "friendly and professional"
  }
);
```

### 2. Enhanced KB with Ollama Fallback

```javascript
const { checkKBWithFallback } = require('./middleware/checkKBWithOllama');
const TraceLogger = require('./utils/traceLogger');

const traceLogger = new TraceLogger();
const result = await checkKBWithFallback(question, companyId, traceLogger, {
  ollamaFallbackEnabled: true,
  company: companyData,
  conversationHistory: []
});

if (result.answer) {
  console.log(`Answer from ${result.source}: ${result.answer}`);
  console.log(`Ollama fallback used: ${result.fallbackUsed}`);
}
```

## Performance Considerations

### Response Times
- **Custom KB**: 10-50ms (database lookup)
- **Ollama Local**: 500-3000ms (depending on model and hardware)
- **Cloud API**: 1000-5000ms (network dependent)

### Model Recommendations

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| `llama3.2:1b` | ~1GB | Fast | Good | High-volume, simple queries |
| `llama3.2:3b` | ~2GB | Medium | Better | **Recommended balance** |
| `llama3.1:8b-instruct-q4_0` | ~5GB | Slower | Best | Complex queries, detailed answers |

### Hardware Requirements
- **Minimum**: 8GB RAM, any modern CPU
- **Recommended**: 16GB RAM, Apple Silicon or modern x64
- **Optimal**: 32GB RAM, dedicated GPU

## Monitoring & Debugging

### 1. Health Monitoring

```bash
# Check Ollama status via API
curl http://localhost:4000/api/ollama/status

# Check Ollama directly
curl http://localhost:11434/api/tags
```

### 2. Performance Monitoring

The service automatically logs:
- Response times for each request
- Success/failure rates
- Model performance metrics
- Fallback usage statistics

### 3. Debug Logs

Enable detailed logging by setting log level:
```bash
export LOG_LEVEL=debug
```

Look for log entries prefixed with:
- `[Ollama]` - Core service logs
- `[KB+Ollama]` - Fallback integration logs
- `[API]` - API endpoint logs

## Troubleshooting

### Common Issues

#### 1. "Ollama service is not available"
**Cause**: Ollama service not running
**Solution**:
```bash
ollama serve
```

#### 2. "Model not found"
**Cause**: Configured model not downloaded
**Solution**:
```bash
ollama pull llama3.2:3b
```

#### 3. Slow responses
**Cause**: Model too large for hardware
**Solution**: Use smaller model like `llama3.2:1b`

#### 4. Connection timeout
**Cause**: Model taking too long to respond
**Solution**: Increase `OLLAMA_TIMEOUT` in `.env`

### Diagnostic Commands

```bash
# Test Ollama installation
ollama --version

# List installed models
ollama list

# Test model directly
ollama run llama3.2:3b "Hello, how are you?"

# Check service status
curl http://localhost:11434/api/tags

# Run integration tests
node test-ollama-integration.js
```

## Production Deployment

### 1. Server Setup

```bash
# Install Ollama on server
curl -fsSL https://ollama.ai/install.sh | sh

# Start service (systemd)
sudo systemctl enable ollama
sudo systemctl start ollama

# Download models
ollama pull llama3.2:3b
```

### 2. Environment Configuration

```bash
# Production .env
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_TIMEOUT=30000
OLLAMA_FALLBACK_ENABLED=true
OLLAMA_CONFIDENCE_THRESHOLD=0.7
```

### 3. Load Balancing

For high-volume deployments, consider:
- Multiple Ollama instances
- Load balancer (nginx/HAProxy)
- Model caching strategies

### 4. Monitoring

Set up monitoring for:
- Ollama service uptime
- Response time metrics
- Memory/CPU usage
- Model performance

## Security Considerations

### Data Privacy
- **✅ Advantage**: All data stays local, never sent to external APIs
- **✅ GDPR/HIPAA Friendly**: No data leaves your infrastructure
- **✅ No API Keys**: No external service dependencies

### Access Control
- Ollama runs on localhost by default (secure)
- API endpoints use existing authentication
- Rate limiting applied to prevent abuse

### Model Updates
- Models downloaded once, cached locally
- No external network calls during inference
- Offline operation capability

## Future Enhancements

### Planned Features
1. **Model Auto-switching**: Use different models based on query complexity
2. **Response Caching**: Cache common responses for faster delivery
3. **Fine-tuning**: Train models on company-specific data
4. **Multi-model Ensemble**: Combine responses from multiple models

### Integration Possibilities
1. **Voice Integration**: Use with speech-to-text pipelines
2. **Multi-language**: Support for non-English queries
3. **Sentiment Analysis**: Emotional context awareness
4. **Knowledge Graph**: Integration with structured knowledge bases

---

## Support & Maintenance

For issues or questions regarding the Ollama integration:

1. Check the troubleshooting section above
2. Run the integration test suite: `node test-ollama-integration.js`
3. Check API status: `GET /api/ollama/status`
4. Review application logs for detailed error information

This integration provides a robust, privacy-focused AI fallback system that enhances your agent platform's capabilities while maintaining complete data control.
