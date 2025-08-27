# AI Agent Logic - Developer Guide

**Last Updated**: December 2024  
**Purpose**: Technical guide for developers working on AI Agent Logic system

---

## 🎯 Quick Start

### Prerequisites
- Node.js 16+
- MongoDB Atlas connection
- Redis instance (optional, for caching)
- Basic understanding of Express.js and MongoDB

### Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Set environment variables (see `.env.example`)
4. Start development server: `npm run dev`
5. Access AI Agent Logic at: `/company-profile.html` → AI Agent Logic tab

---

## 🏗️ System Architecture

### Frontend Architecture
```
company-profile.html
├── AI Agent Logic Tab (lines ~1537-10930)
├── JavaScript Functions (embedded)
├── CSS Styling (Tailwind + custom)
└── Component Integration
    ├── Trade Categories Checkboxes
    ├── Memory & Intelligence Controls
    ├── Agent Settings Forms
    └── Save/Load Logic
```

### Backend Architecture
```
routes/
├── aiAgentLogic.js           # Primary AI Logic API
├── company/agentSettings.js  # Legacy agent settings
└── admin.js                  # Admin management

models/
└── Company.js               # aiAgentLogic schema

services/
├── knowledge/               # Knowledge management
└── clientsViaIntelligenceEngine.js
```

---

## 💾 Database Schema Deep Dive

### Company Model - aiAgentLogic Field

The `aiAgentLogic` field in the Company model stores all AI configuration:

```javascript
// Located in models/Company.js around line 390
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
        memoryMode: { 
            type: String, 
            enum: ['short', 'conversational', 'persistent'], 
            default: 'conversational' 
        },
        contextRetention: { type: Number, min: 5, max: 120, default: 30 }
    },
    
    // Fallback Behavior Configuration
    fallbackBehavior: {
        rejectLowConfidence: { type: Boolean, default: true },
        escalateOnNoMatch: { type: Boolean, default: true },
        message: { 
            type: String, 
            default: 'I want to make sure I give you accurate information. Let me connect you with a specialist who can help.' 
        }
    },
    
    // Knowledge Source Priority Order
    knowledgeSourcePriorities: [{
        source: { type: String, required: true },
        priority: { type: Number, required: true },
        isActive: { type: Boolean, default: true }
    }],
    
    // Timestamps and metadata
    lastUpdated: { type: Date, default: Date.now },
    
    // Additional configurations (flexible schema)
    analyticsSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    abTestingConfigs: { type: mongoose.Schema.Types.Mixed, default: {} },
    flowDesignerData: { type: mongoose.Schema.Types.Mixed, default: {} },
    personalizationRules: { type: mongoose.Schema.Types.Mixed, default: {} }
}
```

### Key Schema Notes
- **Flexible Design**: Uses Mixed types for extensibility
- **Validation**: Built-in min/max constraints for thresholds
- **Defaults**: Sensible defaults for all fields
- **Multi-tenant**: Scoped to company level automatically

---

## 🔌 API Implementation Details

### Primary Route File: `/routes/aiAgentLogic.js`

**Key Endpoints**:
```javascript
// Core configuration
router.get('/admin/:companyID/ai-settings', ...)     // Load settings
router.put('/admin/:companyID/ai-settings', ...)     // Save settings

// Priority flow management
router.get('/priority-flow/:companyId', ...)         // Get priority flow
router.post('/priority-flow/:companyId', ...)        // Save priority flow
router.post('/priority-flow/:companyId/toggle', ...) // Toggle source
router.post('/priority-flow/:companyId/reorder', ...)// Reorder sources

// Analytics & monitoring
router.get('/analytics/:companyId', ...)             // Get analytics
router.get('/metrics/:companyId/realtime', ...)      // Real-time metrics
```

**Authentication Pattern**:
```javascript
const { authenticateSingleSession } = require('../middleware/auth');
router.get('/endpoint', authenticateSingleSession, async (req, res) => {
    // Route logic here
});
```

**Error Handling Pattern**:
```javascript
try {
    // Route logic
    res.json({ success: true, data: result });
} catch (error) {
    console.error('❌ Error in route:', error);
    res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        details: error.message 
    });
}
```

---

## 🎨 Frontend Implementation

### Tab Structure

The AI Agent Logic tab is embedded in `company-profile.html`:

```html
<!-- Main tab container -->
<div id="ai-agent-logic-content" class="tab-content-item hidden">
    <!-- Intelligence & Memory Controls -->
    <div class="bg-gradient-to-r from-purple-50 to-indigo-50">
        <!-- Memory mode dropdown -->
        <select id="ai-memory-mode" class="form-select">
            <option value="short">Short Term</option>
            <option value="conversational">Conversational</option>
            <option value="persistent">Persistent</option>
        </select>
        
        <!-- Context retention slider -->
        <input type="range" id="ai-context-retention" 
               min="5" max="120" value="30" />
    </div>
    
    <!-- Trade Categories Section -->
    <div id="trade-categories-checkboxes">
        <!-- Dynamic checkboxes loaded via JavaScript -->
    </div>
    
    <!-- Save Button -->
    <button onclick="saveAIAgentLogicSettings()" 
            class="btn btn-primary">Save AI Settings</button>
</div>
```

### Key JavaScript Functions

**Primary Save Function** (line ~10379):
```javascript
async function saveAIAgentLogicSettings() {
    console.log('🤖 Starting save process...');
    
    const companyId = getCurrentCompanyId();
    
    // Collect trade categories
    const checkboxes = document.querySelectorAll('#trade-categories-checkboxes input:checked');
    const tradeCategories = Array.from(checkboxes).map(cb => cb.value);
    
    // Collect agent settings
    const agentSettings = {
        llmModel: safeGetValue('agent-llmModel', 'gemini-pro'),
        memoryMode: safeGetValue('agent-memoryMode', 'short'),
        fallbackThreshold: parseFloat(safeGetValue('agent-fallbackThreshold', '0.5')),
        // ... more settings
    };
    
    // Save to backend
    const response = await fetch(`/api/company/companies/${companyId}/agent-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeCategories, agentSettings })
    });
    
    // Handle response
    if (response.ok) {
        showNotification('Settings saved successfully!', 'success');
    } else {
        throw new Error('Save failed');
    }
}
```

**Tab Initialization** (line ~10906):
```javascript
document.addEventListener('DOMContentLoaded', function() {
    const aiAgentTab = document.getElementById('tab-ai-agent-logic');
    if (aiAgentTab) {
        aiAgentTab.addEventListener('click', function() {
            // Switch tab
            if (window.companyProfileManager) {
                window.companyProfileManager.switchTab('ai-agent-logic');
            }
            
            // Load data
            setTimeout(() => {
                loadAgentTradeCategories();
                loadAgentSettings();
                loadAgentPersonalitySettings();
                initKnowledgeSources();
                loadKnowledgeSettings();
                loadAgentAnalytics();
            }, 100);
        });
    }
});
```

---

## 🔧 Development Workflow

### Adding New Features

1. **Backend First Approach**:
   ```javascript
   // 1. Add route to aiAgentLogic.js
   router.post('/new-feature/:companyId', authenticateSingleSession, async (req, res) => {
       // Implementation
   });
   
   // 2. Update Company model schema if needed
   aiAgentLogic: {
       newFeature: { type: Object, default: {} }
   }
   
   // 3. Test with cURL or Postman
   ```

2. **Frontend Integration**:
   ```javascript
   // 1. Add UI elements to company-profile.html
   <div id="new-feature-controls">
       <!-- Controls here -->
   </div>
   
   // 2. Add JavaScript functions
   async function saveNewFeature() {
       // Save logic
   }
   
   function loadNewFeature() {
       // Load logic
   }
   
   // 3. Integrate with tab initialization
   ```

### Testing Strategy

**Backend Testing**:
```bash
# Test API endpoints with cURL
curl -X GET "http://localhost:3000/api/admin/COMPANY_ID/ai-settings" \
  -H "Cookie: session=SESSION_TOKEN"

# Test with sample data
curl -X PUT "http://localhost:3000/api/admin/COMPANY_ID/ai-settings" \
  -H "Content-Type: application/json" \
  -d '{"thresholds": {"companyKB": 0.85}}'
```

**Frontend Testing**:
```javascript
// Browser console testing
getCurrentCompanyId()  // Should return valid company ID
saveAIAgentLogicSettings()  // Should save without errors

// Check form values
document.getElementById('ai-memory-mode').value
document.querySelectorAll('#trade-categories-checkboxes input:checked').length
```

---

## 🐛 Common Issues & Solutions

### Issue: Save Function Not Working
**Symptoms**: Button click does nothing, no API call
**Debug Steps**:
1. Check browser console for JavaScript errors
2. Verify `getCurrentCompanyId()` returns valid ID
3. Check network tab for failed requests
4. Verify authentication session is valid

**Solution**:
```javascript
// Add error handling to save function
try {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
        console.error('API Error:', response.status, response.statusText);
    }
} catch (error) {
    console.error('Network Error:', error);
}
```

### Issue: Settings Not Loading
**Symptoms**: UI shows default values, not saved config
**Debug Steps**:
1. Check if load functions are called on tab activation
2. Verify API endpoint returns 200 status
3. Check database for saved settings
4. Verify UI update logic

**Solution**:
```javascript
// Add debugging to load function
async function loadAgentSettings() {
    console.log('Loading settings for company:', getCurrentCompanyId());
    
    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        console.log('Loaded data:', data);
        
        // Apply to UI
        applySettingsToUI(data);
    } catch (error) {
        console.error('Load error:', error);
    }
}
```

### Issue: Trade Categories Not Saving
**Symptoms**: Checkboxes reset after save/reload
**Debug Steps**:
1. Check if checkboxes are properly selected before save
2. Verify checkbox values are collected correctly
3. Check if backend receives trade categories array
4. Verify database update

**Solution**:
```javascript
// Improved checkbox collection
function collectTradeCategories() {
    const checkboxes = document.querySelectorAll('#trade-categories-checkboxes input[type="checkbox"]:checked');
    const categories = Array.from(checkboxes).map(cb => cb.value).filter(Boolean);
    console.log('Collected categories:', categories);
    return categories;
}
```

---

## 🚀 Performance Optimization

### Redis Caching Implementation
```javascript
// In route handlers
const cacheKey = `ai-settings:company:${companyId}`;

// Get from cache first
const cached = await redisClient.get(cacheKey);
if (cached) {
    return res.json(JSON.parse(cached));
}

// Get from database and cache
const settings = await Company.findById(companyId).select('aiAgentLogic');
await redisClient.setex(cacheKey, 300, JSON.stringify(settings)); // 5min TTL
```

### Database Query Optimization
```javascript
// Use lean queries for read-only operations
const company = await Company.findById(companyId)
    .select('aiAgentLogic tradeCategories')
    .lean();

// Use specific field updates for saves
await Company.findByIdAndUpdate(companyId, {
    $set: {
        'aiAgentLogic.thresholds': newThresholds,
        'aiAgentLogic.lastUpdated': new Date()
    }
});
```

### Frontend Performance
```javascript
// Debounce save operations
const debouncedSave = debounce(saveAIAgentLogicSettings, 1000);

// Cache DOM queries
const elements = {
    memoryMode: document.getElementById('ai-memory-mode'),
    contextRetention: document.getElementById('ai-context-retention'),
    tradeCheckboxes: document.querySelectorAll('#trade-categories-checkboxes input')
};
```

---

## 📊 Monitoring & Analytics

### Logging Best Practices
```javascript
// Structured logging
console.log('🔍 [AI-AGENT-LOGIC]', {
    action: 'save_settings',
    companyId,
    timestamp: new Date().toISOString(),
    settingsCount: Object.keys(settings).length
});

// Error logging with context
console.error('❌ [AI-AGENT-LOGIC]', {
    error: error.message,
    stack: error.stack,
    companyId,
    endpoint: req.originalUrl
});
```

### Performance Metrics
```javascript
// Track save performance
const startTime = Date.now();
await saveSettings();
const duration = Date.now() - startTime;
console.log(`⏱️ Save completed in ${duration}ms`);

// Track API response times
router.use('/api/admin/:companyID/ai-settings', (req, res, next) => {
    req.startTime = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - req.startTime;
        console.log(`📊 API ${req.method} ${req.path}: ${duration}ms`);
    });
    next();
});
```

---

## 🔐 Security Considerations

### Multi-tenant Isolation
```javascript
// Always validate company access
router.get('/admin/:companyID/ai-settings', authenticateSingleSession, async (req, res) => {
    const { companyID } = req.params;
    
    // Verify user has access to this company
    if (req.user.companyId.toString() !== companyID) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Proceed with request
});
```

### Input Validation
```javascript
// Validate thresholds
function validateThresholds(thresholds) {
    for (const [key, value] of Object.entries(thresholds)) {
        if (typeof value !== 'number' || value < 0 || value > 1) {
            throw new Error(`Invalid threshold for ${key}: ${value}`);
        }
    }
}

// Sanitize user input
const sanitizedInput = {
    memoryMode: ['short', 'conversational', 'persistent'].includes(input.memoryMode) 
        ? input.memoryMode 
        : 'conversational'
};
```

---

## 📚 Additional Resources

### Related Documentation
- [Company Model Schema](./models/Company.js)
- [API Reference](./AI_AGENT_LOGIC_API_REFERENCE.md)
- [Current System Documentation](./AI_AGENT_LOGIC_CURRENT_DOCUMENTATION.md)

### External Dependencies
- **MongoDB**: Database storage
- **Redis**: Caching layer
- **Express.js**: Web framework
- **Mongoose**: MongoDB ODM

### Development Tools
- **Postman**: API testing
- **MongoDB Compass**: Database inspection
- **Redis CLI**: Cache inspection
- **Chrome DevTools**: Frontend debugging

---

*This developer guide is current as of December 2024. Update as the system evolves and new features are added.*
