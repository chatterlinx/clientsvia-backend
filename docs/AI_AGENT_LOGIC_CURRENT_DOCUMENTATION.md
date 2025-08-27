# AI Agent Logic - Current System Documentation

**Last Updated**: December 2024  
**Status**: Production Ready  
**Version**: Current Implementation

---

## 🎯 Overview

The AI Agent Logic tab is a **production-ready, multi-tenant configuration system** that allows companies to customize their AI agent's behavior, knowledge routing, and response generation. It's integrated into the company profile page and provides a comprehensive interface for managing intelligent call handling.

---

## 🏗️ System Architecture

### Frontend Structure
- **Location**: `/public/company-profile.html` (lines ~1537-10930)
- **Tab ID**: `ai-agent-logic-content`
- **JavaScript**: Embedded in same HTML file
- **Components**: Intelligence & Memory controls, trade categories, agent settings

### Backend API
- **Primary Route**: `/routes/aiAgentLogic.js`
- **Secondary Route**: `/routes/company/agentSettings.js`
- **Database**: Company model with `aiAgentLogic` field [[memory:7289715]]

---

## 🔧 Current API Endpoints

### Core Configuration Endpoints

#### 1. **Load AI Settings**
```http
GET /api/admin/:companyID/ai-settings
```
- **Purpose**: Load company-specific AI configuration
- **Authentication**: Required (single session)
- **Response**: Complete AI settings structure
- **Used by**: Tab initialization

#### 2. **Save AI Settings** 
```http
PUT /api/admin/:companyID/ai-settings
```
- **Purpose**: Save complete AI configuration
- **Authentication**: Required (single session)
- **Body**: AI settings object with thresholds, memory, etc.

#### 3. **Save Agent Settings** (Legacy)
```http
POST /api/company/companies/:id/agent-settings
```
- **Purpose**: Save trade categories and agent intelligence settings
- **Body**: `{ tradeCategories, agentIntelligenceSettings, aiAgentLogic }`

### Additional Endpoints
- `GET /api/ai-agent/priority-flow/:companyId` - Load priority flow
- `POST /api/ai-agent/priority-flow/:companyId` - Save priority flow
- `GET /api/ai-agent/analytics/:companyId` - Analytics data
- `POST /api/ai-agent/save-config` - Save complete configuration

---

## 💾 Database Schema

### Company Model - aiAgentLogic Field
```javascript
aiAgentLogic: {
    // Knowledge source confidence thresholds
    thresholds: {
        companyQnA: { type: Number, min: 0, max: 1, default: 0.8 },
        tradeQnA: { type: Number, min: 0, max: 1, default: 0.75 },
        vectorSearch: { type: Number, min: 0, max: 1, default: 0.7 },
        llmFallback: { type: Number, min: 0, max: 1, default: 0.6 }
    },
    
    // Memory & Intelligence Settings
    memorySettings: {
        memoryMode: { type: String, enum: ['short', 'conversational', 'persistent'], default: 'conversational' },
        contextRetention: { type: Number, min: 5, max: 120, default: 30 }
    },
    
    // Fallback Behavior Configuration
    fallbackBehavior: {
        rejectLowConfidence: { type: Boolean, default: true },
        escalateOnNoMatch: { type: Boolean, default: true },
        message: { type: String, default: 'I want to make sure I give you accurate information...' }
    },
    
    // Knowledge Source Priority Order
    knowledgeSourcePriorities: [{
        source: { type: String, required: true },
        priority: { type: Number, required: true },
        isActive: { type: Boolean, default: true }
    }],
    
    // Metadata
    lastUpdated: { type: Date, default: Date.now }
}
```

---

## 🎛️ Frontend Interface Components

### 1. **Intelligence & Memory Section**
- **Memory Mode Dropdown**: Short Term, Conversational, Persistent
- **Context Retention Slider**: 5-120 minutes (default: 30)
- **Memory Optimization Toggle**: Auto-optimize based on usage patterns

### 2. **Trade Categories**
- **Dynamic Checkboxes**: Loaded from enterprise trade categories
- **Multi-select**: Companies can choose multiple trade specializations
- **Validation**: Only valid enterprise categories accepted

### 3. **Agent Settings** (If Present)
- **LLM Model Selection**: Gemini Pro, GPT-4o-mini, etc.
- **Memory Mode**: Short, conversational settings
- **Fallback Threshold**: Confidence threshold for escalation
- **Feature Toggles**: Semantic search, confidence scoring, auto-learning

---

## 🔄 Save/Load Process

### Save Functionality
1. **Primary Save Function**: `saveAIAgentLogicSettings()`
2. **Data Collection**: 
   - Trade categories from checkboxes
   - Agent settings from form inputs
   - Memory and intelligence settings
3. **API Call**: `POST /api/company/companies/${companyId}/agent-settings`
4. **Error Handling**: Comprehensive error messages and user feedback

### Load Functionality
1. **Initialization**: Triggered when AI Agent Logic tab is clicked
2. **Multiple Loaders**:
   - `loadAgentTradeCategories()` - Load checkbox states
   - `loadAgentSettings()` - Load agent configuration
   - `loadAgentPersonalitySettings()` - Load personality settings
3. **UI Population**: Apply loaded data to form elements

---

## 🎯 Key Features Currently Implemented

### ✅ **Production Ready Features**
- Multi-tenant company isolation [[memory:7283147]]
- Trade category selection and validation
- Memory mode configuration (short/conversational/persistent)
- Context retention settings (5-120 minutes)
- Agent settings persistence
- Error handling and user feedback
- Responsive UI design

### ✅ **Integration Points**
- Company profile tab system
- Enterprise trade categories system
- MongoDB persistence with Company model
- Redis caching for performance [[memory:7289715]]
- Authentication and authorization

---

## 🐛 Current Limitations & Technical Debt

### **Frontend Issues**
- Multiple save functions exist (`saveAIAgentLogicSettings`, `saveAgentSettings`)
- Some legacy code references outdated endpoints
- Tab switching logic could be simplified
- Inconsistent error handling patterns

### **Backend Issues**
- Multiple overlapping API endpoints for similar functionality
- Some routes in `aiAgentLogic.js` may not be fully connected to frontend
- Legacy endpoint `/api/company/companies/:id/agent-settings` still in use

### **Documentation Issues**
- Previous documentation was outdated and misleading
- API endpoint documentation scattered across multiple files
- No clear single source of truth for current functionality

---

## 🎛️ User Experience Flow

### **Tab Access**
1. User clicks "AI Agent Logic" tab in company profile
2. Tab content loads with current company settings
3. Multiple initialization functions run to populate interface

### **Configuration**
1. User adjusts memory mode, context retention, trade categories
2. Changes are reflected in UI immediately
3. Save button updates backend and shows success/error feedback

### **Persistence**
1. Settings saved to Company model `aiAgentLogic` field
2. Multi-tenant isolation ensures company-specific settings [[memory:7283147]]
3. Redis cache cleared for performance [[memory:7289715]]

---

## 🚀 Recommendations for Improvement

### **Immediate Priorities**
1. **Consolidate Save Functions**: Create single, comprehensive save function
2. **Clean Up API Endpoints**: Remove unused/duplicate endpoints
3. **Improve Error Handling**: Standardize error messages and user feedback
4. **Update Frontend**: Remove legacy code and simplify tab logic

### **Future Enhancements**
1. **Real-time Validation**: Validate settings as user types
2. **Preview Mode**: Allow users to test settings before saving
3. **Analytics Integration**: Show performance metrics for current settings
4. **Bulk Configuration**: Allow copying settings between companies

---

## 🔍 Debugging & Troubleshooting

### **Common Issues**
1. **Save Not Working**: Check browser console for JavaScript errors
2. **Settings Not Loading**: Verify company ID and authentication
3. **Trade Categories Empty**: Check enterprise trade categories collection
4. **Memory Settings Reset**: Verify database field structure

### **Debug Commands**
```javascript
// Browser console debugging
getCurrentCompanyId()  // Check company ID
saveAIAgentLogicSettings()  // Test save function

// Check form values
document.getElementById('ai-memory-mode').value
document.querySelectorAll('#trade-categories-checkboxes input:checked')
```

---

## 📊 Current Status Summary

### **What Works** ✅
- Tab loads and displays correctly
- Trade categories save and load properly
- Memory settings persist in database
- Multi-tenant isolation functions correctly
- Error handling provides user feedback

### **What Needs Work** ⚠️
- Multiple save functions need consolidation
- API endpoints need cleanup and documentation
- Frontend code has legacy remnants
- User experience could be more streamlined

### **What's Missing** ❌
- Real-time configuration preview
- Performance analytics integration
- Bulk configuration management
- Comprehensive testing coverage

---

*This documentation reflects the current state of the AI Agent Logic system as of December 2024. It should be updated as the system evolves.*
