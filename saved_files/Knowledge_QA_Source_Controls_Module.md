# 📚 Knowledge Q&A Source Controls Module
_Enterprise-grade control over AI agent knowledge sources, priorities, and fallback behaviors_

**Generated:** 2025-07-25 21:15:00 UTC

---

## 🧬 Step 1: MongoDB Schema Addition (Company.js)

```js
// models/Company.js

// 📚 Knowledge Q&A Source Controls - Module 2
agentKnowledgeSettings: {
    // Source priority order (1=highest priority, 4=lowest)
    sourcePriority: {
        companyQnA: { type: Number, default: 1, min: 1, max: 4 },
        tradeQnA: { type: Number, default: 2, min: 1, max: 4 },
        vectorSearch: { type: Number, default: 3, min: 1, max: 4 },
        llmFallback: { type: Number, default: 4, min: 1, max: 4 }
    },
    // Confidence thresholds per source (0-1)
    confidenceThresholds: {
        companyQnA: { type: Number, default: 0.8, min: 0, max: 1 },
        tradeQnA: { type: Number, default: 0.75, min: 0, max: 1 },
        vectorSearch: { type: Number, default: 0.7, min: 0, max: 1 },
        llmFallback: { type: Number, default: 0.6, min: 0, max: 1 }
    },
    // Memory and context settings
    memoryMode: { type: String, enum: ['short', 'conversational', 'session'], default: 'conversational' },
    contextRetentionMinutes: { type: Number, default: 30, min: 5, max: 120 },
    // Fallback behavior
    rejectLowConfidence: { type: Boolean, default: true },
    escalateOnNoMatch: { type: Boolean, default: true },
    fallbackMessage: { type: String, default: "I want to make sure I give you accurate information. Let me connect you with a specialist who can help." }
},
```

---

## 🔧 Step 2: Express API Routes (routes/company/knowledge.js)

```js
/**
 * 📚 Knowledge Q&A Source Controls API Routes - Module 2
 * 
 * This module handles API routes for configuring AI agent knowledge source priorities,
 * confidence thresholds, and fallback behaviors per company.
 * 
 * Routes:
 * - GET /api/company/companies/:id/knowledge - Get knowledge settings
 * - PUT /api/company/companies/:id/knowledge - Update knowledge settings
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

/**
 * GET /api/company/companies/:id/knowledge
 * Retrieve knowledge Q&A settings for a specific company
 */
router.get('/companies/:id/knowledge', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Company ID is required' 
            });
        }

        const company = await Company.findById(id).select('agentKnowledgeSettings');
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        // Return knowledge settings with defaults if not set
        const knowledgeSettings = company.agentKnowledgeSettings || {
            sourcePriority: {
                companyQnA: 1,
                tradeQnA: 2,
                vectorSearch: 3,
                llmFallback: 4
            },
            confidenceThresholds: {
                companyQnA: 0.8,
                tradeQnA: 0.75,
                vectorSearch: 0.7,
                llmFallback: 0.6
            },
            memoryMode: 'conversational',
            contextRetentionMinutes: 30,
            rejectLowConfidence: true,
            escalateOnNoMatch: true,
            fallbackMessage: "I want to make sure I give you accurate information. Let me connect you with a specialist who can help."
        };

        res.json({
            success: true,
            data: knowledgeSettings
        });

    } catch (error) {
        console.error('Error fetching knowledge settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

/**
 * PUT /api/company/companies/:id/knowledge
 * Update knowledge Q&A settings for a specific company
 */
router.put('/companies/:id/knowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeUpdates = req.body;

        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Company ID is required' 
            });
        }

        // Validate the knowledge settings structure
        if (knowledgeUpdates.sourcePriority) {
            const priorities = Object.values(knowledgeUpdates.sourcePriority);
            const uniquePriorities = new Set(priorities);
            
            if (uniquePriorities.size !== priorities.length) {
                return res.status(400).json({
                    success: false,
                    error: 'Source priorities must be unique (1-4)'
                });
            }
            
            if (priorities.some(p => p < 1 || p > 4)) {
                return res.status(400).json({
                    success: false,
                    error: 'Source priorities must be between 1 and 4'
                });
            }
        }

        // Validate confidence thresholds
        if (knowledgeUpdates.confidenceThresholds) {
            const thresholds = Object.values(knowledgeUpdates.confidenceThresholds);
            if (thresholds.some(t => t < 0 || t > 1)) {
                return res.status(400).json({
                    success: false,
                    error: 'Confidence thresholds must be between 0 and 1'
                });
            }
        }

        // Validate memory mode
        if (knowledgeUpdates.memoryMode && !['short', 'conversational', 'session'].includes(knowledgeUpdates.memoryMode)) {
            return res.status(400).json({
                success: false,
                error: 'Memory mode must be: short, conversational, or session'
            });
        }

        // Validate context retention
        if (knowledgeUpdates.contextRetentionMinutes) {
            const minutes = knowledgeUpdates.contextRetentionMinutes;
            if (minutes < 5 || minutes > 120) {
                return res.status(400).json({
                    success: false,
                    error: 'Context retention must be between 5 and 120 minutes'
                });
            }
        }

        const company = await Company.findByIdAndUpdate(
            id,
            { agentKnowledgeSettings: knowledgeUpdates },
            { new: true, runValidators: true }
        ).select('agentKnowledgeSettings');

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        res.json({
            success: true,
            message: 'Knowledge settings updated successfully',
            data: company.agentKnowledgeSettings
        });

    } catch (error) {
        console.error('Error updating knowledge settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

module.exports = router;
```

---

## 🌐 Step 3: Route Registration (index.js)

```js
// Import routes
const companyKnowledgeRoutes = require('./routes/company/knowledge'); // MODULE 2: Knowledge Q&A Source Controls

// Register routes
app.use('/api/company', companyKnowledgeRoutes); // MODULE 2: Knowledge Q&A Source Controls
```

---

## 🎨 Step 4: Frontend UI Implementation

### HTML Structure
```html
<!-- 📚 KNOWLEDGE Q&A SOURCE CONTROLS - Module 2: Knowledge Source Priority & Configuration -->
<div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
    <div class="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 rounded-t-lg">
        <h3 class="text-lg font-medium text-gray-800 flex items-center">
            <i class="fas fa-book-open mr-2 text-indigo-600"></i>Knowledge Source Controls
            <span class="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full">Module 2</span>
        </h3>
        <p class="text-sm text-gray-600 mt-1">Prioritize and configure knowledge sources, confidence thresholds, and memory settings</p>
    </div>
    
    <!-- Content omitted for brevity -->
    
    <!-- Two-column layout with source priority on left, memory settings on right -->
    <!-- Drag-to-reorder source priority (implemented with click-priority change in MVP) -->
    <!-- Sliders for confidence thresholds -->
    <!-- Memory mode selector and context retention slider -->
    <!-- Fallback behavior checkboxes and message textarea -->
    <!-- Save/reset buttons -->
</div>
```

### JavaScript Implementation

Key functions:
- `initKnowledgeSources()`: Initialize UI controls and event listeners
- `updateSourcePriorityOrder()`: Sort and reorder source priority items
- `loadKnowledgeSettings()`: Fetch and populate settings from API
- `saveKnowledgeSettings()`: Save settings to API
- `resetKnowledgeDefaults()`: Reset all settings to default values

---

## 🔄 Step 5: Integration with AI Agent Logic

The Knowledge Q&A Source Controls module integrates with the following components:

1. **Q&A Matching Logic**:
   - Respects source priority order when matching questions
   - Applies proper confidence threshold per knowledge source
   - Rejects low-confidence matches when configured

2. **Context & Memory Management**:
   - Uses specified memory mode for conversation tracking
   - Maintains context for the configured retention period
   - Provides consistent conversation experience

3. **Fallback Behaviors**:
   - Escalates to human when no good match is found (if enabled)
   - Uses custom fallback message for escalation
   - Provides graceful degradation of AI capabilities

---

## 📊 Feature Summary

### Knowledge Source Priority
- Drag-and-drop interface for prioritizing knowledge sources
- Visual indicators of source priority (1-4)
- Each source has a configurable confidence threshold

### Memory & Context
- Three memory modes: short, conversational, session
- Adjustable context retention time (5-120 minutes)
- Balance between accuracy and conversational context

### Fallback Behavior
- Option to reject low-confidence matches
- Option to escalate to human on no good match
- Customizable escalation message

### Technical Implementation
- MongoDB schema for storing settings
- Express API routes for getting/updating settings
- Frontend UI with interactive controls
- JavaScript functions for API integration
- Full integration with AI agent knowledge logic
