# ClientsVia API Quick Reference for Codex/Copilot

## 🎯 **Base URL for ALL Requests**
```
https://clientsvia-backend.onrender.com
```

## 🚨 **CRITICAL RULES**
1. **ALWAYS validate IDs exist before PATCH/POST/DELETE**
2. **Use ONLY new database IDs** (no legacy IDs like `685fbe32f2dd80e7e46ba663`)
3. **GET first, then modify** - confirm entity exists
4. **All API keys via environment variables or company settings**

## 📋 **API Endpoints**

### Company Management
```bash
# Get all companies (start here to get valid IDs)
GET /api/company

# Get specific company (validate before operations)
GET /api/company/{companyId}

# Create company
POST /api/company
{
  "companyName": "Company Name",
  "ownerName": "Owner Name", 
  "ownerEmail": "owner@company.com",
  "contactPhone": "555-123-4567",
  "timezone": "America/New_York"
}

# Update company (validate first)
PATCH /api/company/{companyId}
```

### Trade Categories
```bash
# Validate company exists first
GET /api/company/{companyId}

# Get all trade categories for company
GET /api/company/{companyId}/trade-categories

# Get specific category (validate before operations)
GET /api/company/{companyId}/trade-categories/{categoryId}

# Create trade category
POST /api/company/{companyId}/trade-categories
{
  "name": "Air Conditioning",
  "description": "AC repair services"
}

# Update trade category (validate first)
PATCH /api/company/{companyId}/trade-categories/{categoryId}
```

### Q&A Management
```bash
# Validate company AND category exist first
GET /api/company/{companyId}/trade-categories/{categoryId}

# Get Q&A for category
GET /api/company/{companyId}/trade-categories/{categoryId}/qa

# Add Q&A to category
POST /api/company/{companyId}/trade-categories/{categoryId}/qa
{
  "question": "What is your service area?",
  "answer": "We serve the metro area."
}

# Update Q&A (validate all IDs first)
PATCH /api/company/{companyId}/trade-categories/{categoryId}/qa/{qaId}
```

### API Settings (TTS Keys)
```bash
# Get current settings
GET /api/company/{companyId}/settings

# Update API keys
PATCH /api/company/{companyId}/settings
{
  "elevenLabsApiKey": "sk_...",
  "elevenLabsVoiceId": "21m00Tcm4TlvDq8ikWAM",
  "googleTTSApiKey": "your_key",
  "googleTTSVoice": "en-US-Standard-B"
}
```

### Agent Setup
```bash
# Get agent configuration
GET /api/company/{companyId}/agent-setup

# Update agent setup
PATCH /api/company/{companyId}/agent-setup
{
  "greeting": "Hello! How can I help?",
  "businessHours": {
    "monday": {"start": "08:00", "end": "17:00"}
  }
}
```

## 🔧 **Validation Pattern (ALWAYS USE)**
```bash
# 1. First - validate entity exists
GET /api/company/{companyId}
# Check response is 200, not 404

# 2. Then - perform operation
PATCH /api/company/{companyId}
# or POST/DELETE
```

## 🧪 **Test New Database**
```bash
# Run the comprehensive test
./test-company.sh

# Get valid company ID for testing
curl https://clientsvia-backend.onrender.com/api/company
```

## 🔑 **Environment Variables**
Set in deployment platform (Render/Heroku):
```bash
ELEVENLABS_API_KEY=your_key
GOOGLE_TTS_API_KEY=your_key
API_BASE_URL=https://clientsvia-backend.onrender.com
```

## ✅ **Example Workflow**
```bash
# 1. Get all companies
COMPANIES=$(curl -s https://clientsvia-backend.onrender.com/api/company)

# 2. Extract company ID (use jq or manually)
COMPANY_ID="67f123..." # from step 1

# 3. Validate company exists
curl https://clientsvia-backend.onrender.com/api/company/$COMPANY_ID

# 4. Now safe to modify
curl -X PATCH https://clientsvia-backend.onrender.com/api/company/$COMPANY_ID \
  -H "Content-Type: application/json" \
  -d '{"companyName": "Updated Name"}'
```

## 🚫 **DO NOT USE**
- Old company IDs like `685fbe32f2dd80e7e46ba663`
- Direct modifications without validation
- Legacy endpoints or data
- Hardcoded API keys in code

## ✅ **ALWAYS DO**
- GET before PATCH/POST/DELETE
- Use https://clientsvia-backend.onrender.com
- Validate all IDs exist
- Use new database IDs only
- Set API keys via environment/settings
