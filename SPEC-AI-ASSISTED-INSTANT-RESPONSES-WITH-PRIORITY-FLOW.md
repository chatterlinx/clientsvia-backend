# 🎯 AI-ASSISTED INSTANT RESPONSES WITH PRIORITY FLOW
## Complete Engineering Specification for Production Implementation

---

**Project Name:** Priority 0 Instant Response System with In-House Variation Engine  
**Version:** 1.0.0  
**Last Updated:** December 2024  
**Status:** Ready for Implementation  
**Target Completion:** 5 business days  

---

## 📋 TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Database Schema](#database-schema)
4. [Backend Components](#backend-components)
5. [Frontend Components](#frontend-components)
6. [Integration Points](#integration-points)
7. [Testing Requirements](#testing-requirements)
8. [Deployment Checklist](#deployment-checklist)
9. [File Structure](#file-structure)
10. [Code Standards](#code-standards)

---

## 🎯 PROJECT OVERVIEW

### **What We Are Building**

A **Priority 0 (Instant Response) system** that provides sub-5ms responses to common caller queries (greetings, emergencies, human requests) BEFORE checking Company Q&A, Trade Q&A, Templates, or Fallback responses.

### **Core Requirements**

1. ✅ **100% In-House** - No external LLM APIs (no OpenAI, no third-party AI)
2. ✅ **Multi-Tenant** - Each company has isolated instant responses
3. ✅ **Admin Full Control** - Add, edit, delete any instant response
4. ✅ **Built-in Variation Suggester** - In-house dictionary of common variations
5. ✅ **Company-to-Company Copy** - Clone instant responses between similar companies
6. ✅ **Export/Import** - JSON download/upload for portability
7. ✅ **Template Library** - Global pre-built templates by industry/category
8. ✅ **Test Matcher** - Inline testing before saving
9. ✅ **Sub-5ms Performance** - Word-boundary regex matching for speed
10. ✅ **Priority Integration** - Seamlessly integrates as Priority 0 in existing 4-tier system

### **Business Value**

- **Speed:** Instant responses (< 5ms) for common queries → better caller experience
- **Efficiency:** Reduces load on Company Q&A and other slower systems
- **Scalability:** Once configured for one HVAC company, copy to all HVAC companies
- **Control:** Admins maintain full control, no AI unpredictability
- **Cost:** Zero per-call API costs (all in-house)

### **Integration Context**

This system integrates into the **existing 5-tier priority flow**:

```
Priority 0: Instant Responses    (NEW - this project)  < 5ms
Priority 1: Company Q&A          (existing)            ~50ms
Priority 2: Trade Q&A            (existing)            ~75ms
Priority 3: Templates            (existing)            ~100ms
Priority 4: In-House Fallback    (existing)            ~50ms
```

**Integration Point:** `/services/v2priorityDrivenKnowledgeRouter.js`

---

## 🏗️ SYSTEM ARCHITECTURE

### **High-Level Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                      TWILIO INCOMING CALL                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    V2 AI AGENT RUNTIME                           │
│               /services/v2AIAgentRuntime.js                     │
│                                                                  │
│  generateV2Response() calls Priority Router                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              PRIORITY-DRIVEN KNOWLEDGE ROUTER                    │
│        /services/v2priorityDrivenKnowledgeRouter.js             │
│                                                                  │
│  routeQuery() → executePriorityRouting()                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Priority 0: queryInstantResponses() ← NEW              │    │
│  │      ↓ (if no match)                                   │    │
│  │ Priority 1: queryCompanyQnA()                          │    │
│  │      ↓ (if < 0.8)                                      │    │
│  │ Priority 2: queryTradeQnA()                            │    │
│  │      ↓ (if < 0.75)                                     │    │
│  │ Priority 3: queryTemplates()                           │    │
│  │      ↓ (if < 0.7)                                      │    │
│  │ Priority 4: queryInHouseFallback()                     │    │
│  └────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               INSTANT RESPONSE MATCHER                           │
│          /services/v2InstantResponseMatcher.js                  │
│                                                                  │
│  • Word-boundary regex matching                                 │
│  • Sub-5ms performance target                                   │
│  • Multiple match types: exact, word-boundary, contains, etc.   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RESPONSE TO TWILIO                            │
│         /routes/v2twilio.js (v2-agent-respond)                  │
│                                                                  │
│  • Apply personality tone                                       │
│  • Replace Quick Variables                                      │
│  • Generate TTS (ElevenLabs or Twilio)                         │
└─────────────────────────────────────────────────────────────────┘
```

### **Component Diagram**

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (UI)                             │
│  /public/company-profile.html + /public/js/components/           │
│                                                                   │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Instant Responses   │  │ Template Library Modal          │  │
│  │ Tab (already exists)│  │ (browse pre-built templates)    │  │
│  └─────────┬───────────┘  └──────────────┬───────────────────┘  │
│            │                              │                       │
│  ┌─────────▼──────────────────────────────▼───────────────────┐  │
│  │    InstantResponsesManager.js (NEW)                        │  │
│  │    • Load/render instant responses                         │  │
│  │    • Add/Edit/Delete modals                                │  │
│  │    • Test matcher widget                                   │  │
│  │    • Variation suggester (in-house)                        │  │
│  │    • Copy from company modal                               │  │
│  │    • Export/Import JSON                                    │  │
│  └────────────────────────────┬───────────────────────────────┘  │
└───────────────────────────────┼───────────────────────────────────┘
                                │
                         API Calls (fetch)
                                │
┌───────────────────────────────▼───────────────────────────────────┐
│                         BACKEND (API)                              │
│  /routes/company/v2instantResponses.js (NEW)                      │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ REST API Endpoints:                                        │  │
│  │ • GET    /api/company/:companyId/instant-responses         │  │
│  │ • POST   /api/company/:companyId/instant-responses         │  │
│  │ • PUT    /api/company/:companyId/instant-responses/:id     │  │
│  │ • DELETE /api/company/:companyId/instant-responses/:id     │  │
│  │ • POST   /api/company/:companyId/instant-responses/test    │  │
│  │ • GET    /api/company/:companyId/instant-responses/export  │  │
│  │ • POST   /api/company/:companyId/instant-responses/import  │  │
│  │ • POST   /api/company/:companyId/instant-responses/        │  │
│  │          copy-from/:sourceCompanyId                        │  │
│  │ • GET    /api/company/:companyId/instant-responses/        │  │
│  │          suggest-variations                                │  │
│  │ • GET    /api/company/:companyId/instant-responses/stats   │  │
│  └────────────────────────────┬───────────────────────────────┘  │
└────────────────────────────────┼───────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SERVICES LAYER                               │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ v2InstantResponseMatcher.js (NEW)                          │ │
│  │ • Word-boundary matching                                   │ │
│  │ • Exact matching                                           │ │
│  │ • Contains matching                                        │ │
│  │ • Starts-with matching                                     │ │
│  │ • Performance: < 5ms                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ variationSuggestionEngine.js (NEW)                         │ │
│  │ • In-house variation suggester (no LLM)                    │ │
│  │ • Uses built-in dictionary                                 │ │
│  │ • Levenshtein distance for typos                           │ │
│  │ • Category detection                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ v2priorityDrivenKnowledgeRouter.js (UPDATE)                │ │
│  │ • Add queryInstantResponses() method                       │ │
│  │ • Add case 'instantResponses' in switch                    │ │
│  │ • Update priority flow to include Priority 0               │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ v2Company.js (UPDATE)                                      │ │
│  │ • company.instantResponses[] (per-company)                 │ │
│  │ • company.instantResponseTemplates{} (metadata)            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ InstantResponseTemplate.js (NEW)                           │ │
│  │ • Global template library (shared across all companies)    │ │
│  │ • Organized by industry and category                       │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      CONFIGURATION                                │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ /config/instantResponseVariations.js (NEW)                 │ │
│  │ • Built-in variation dictionary (no LLM)                   │ │
│  │ • 7 categories: greeting, human-request, emergency,        │ │
│  │   hours, location, pricing, goodbye                        │ │
│  │ • 100+ pre-defined variations per category                 │ │
│  │ • Response templates per category                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ DATABASE SCHEMA

### **1. Update v2Company Model**

**File:** `/models/v2Company.js`

**Changes Required:**

```javascript
// ADD THIS TO EXISTING v2Company SCHEMA

// ============================================================================
// INSTANT RESPONSES - PRIORITY 0 SYSTEM
// 📋 Per-company instant responses for sub-5ms query matching
// 🎯 PURPOSE: Handle common queries (greetings, emergencies) instantly
// ⚡ PERFORMANCE: < 5ms response time using word-boundary matching
// ============================================================================

instantResponses: [{
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId()
    },
    
    // The trigger word/phrase that will be matched
    trigger: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true  // Index for faster queries
    },
    
    // The instant response text
    response: {
        type: String,
        required: true,
        trim: true
    },
    
    // How to match the trigger
    matchType: {
        type: String,
        enum: ['exact', 'word-boundary', 'contains', 'starts-with'],
        default: 'word-boundary',
        required: true
    },
    
    // Category for organization and filtering
    category: {
        type: String,
        enum: [
            'greeting',         // hello, hi, hey
            'human-request',    // transfer, person, human
            'emergency',        // urgent, emergency, asap
            'hours',           // hours, open, closed
            'location',        // address, where, directions
            'pricing',         // price, cost, quote
            'goodbye',         // bye, thanks, goodbye
            'custom'           // user-defined
        ],
        default: 'custom',
        required: true,
        index: true  // Index for filtering by category
    },
    
    // Active/inactive flag
    isActive: {
        type: Boolean,
        default: true,
        index: true  // Index for filtering active responses
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    // Admin tracking
    createdBy: {
        type: String,
        trim: true
    },
    
    // Internal notes for admins
    notes: {
        type: String,
        trim: true
    },
    
    // Performance and usage statistics
    stats: {
        totalMatches: {
            type: Number,
            default: 0,
            min: 0
        },
        lastTriggered: {
            type: Date,
            default: null
        },
        avgResponseTime: {
            type: Number,
            default: null,
            min: 0
        }
    }
}],

// ============================================================================
// INSTANT RESPONSE TEMPLATES METADATA
// 📋 Track template imports and custom templates per company
// ============================================================================

instantResponseTemplates: {
    // Track last import for audit trail
    lastImportedFrom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    
    lastImportedAt: {
        type: Date,
        default: null
    },
    
    // Company-specific custom templates (not in global library)
    customTemplates: [{
        name: {
            type: String,
            trim: true,
            required: true
        },
        triggers: [{
            type: String,
            trim: true,
            lowercase: true
        }],
        response: {
            type: String,
            trim: true,
            required: true
        },
        category: {
            type: String,
            enum: ['greeting', 'human-request', 'emergency', 'hours', 
                   'location', 'pricing', 'goodbye', 'custom'],
            default: 'custom'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}

// ============================================================================
// UPDATE PRIORITY CONFIG ENUM TO INCLUDE 'instantResponses'
// ============================================================================

// FIND THIS IN EXISTING SCHEMA:
// aiAgentLogic.knowledgeSourcePriorities.priorityFlow[].source

// UPDATE enum TO:
source: {
    type: String,
    enum: [
        'instantResponses',  // ← ADD THIS (Priority 0)
        'companyQnA',
        'tradeQnA',
        'templates',
        'inHouseFallback'
    ],
    required: true
}

// ADD DEFAULT PRIORITY CONFIG (if not exists)
// This ensures new companies have Priority 0 enabled by default

// In the aiAgentLogic.knowledgeSourcePriorities field:
default: {
    priorityFlow: [
        {
            source: 'instantResponses',
            priority: 0,
            threshold: 1.0,  // Instant responses are always confidence 1.0
            enabled: true
        },
        {
            source: 'companyQnA',
            priority: 1,
            threshold: 0.8,
            enabled: true
        },
        {
            source: 'tradeQnA',
            priority: 2,
            threshold: 0.75,
            enabled: true
        },
        {
            source: 'templates',
            priority: 3,
            threshold: 0.7,
            enabled: true
        },
        {
            source: 'inHouseFallback',
            priority: 4,
            threshold: 0.5,
            enabled: true
        }
    ]
}
```

### **2. Create InstantResponseTemplate Model**

**File:** `/models/InstantResponseTemplate.js` (NEW)

```javascript
// ============================================================================
// INSTANT RESPONSE TEMPLATE MODEL
// 📋 DESCRIPTION: Global template library for instant responses
// 🎯 PURPOSE: Provide pre-built instant responses that companies can copy
// 🔧 FEATURES: 
//     - Organized by industry (HVAC, plumbing, electrical, etc.)
//     - Organized by category (greeting, emergency, etc.)
//     - System templates vs user-created templates
//     - Usage tracking across companies
// 📝 FUTURE EXPANSION:
//     - Rating system (companies can rate templates)
//     - Auto-suggest templates based on industry
//     - Template versioning
// ⚠️  CRITICAL NOTES:
//     - System templates (isSystemTemplate: true) cannot be deleted
//     - User templates can be shared across companies
//     - Templates are COPIED to companies, not referenced
// ============================================================================

const mongoose = require('mongoose');

const InstantResponseTemplateSchema = new mongoose.Schema({
    
    // ========================================================================
    // BASIC INFORMATION
    // ========================================================================
    
    // Template name for display
    name: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    
    // Category for filtering
    category: {
        type: String,
        enum: [
            'greeting',
            'human-request',
            'emergency',
            'hours',
            'location',
            'pricing',
            'goodbye',
            'custom'
        ],
        required: true,
        index: true
    },
    
    // Industry for filtering (supports multi-industry)
    industry: {
        type: String,
        enum: [
            'general',      // Works for all industries
            'hvac',
            'plumbing',
            'electrical',
            'roofing',
            'landscaping',
            'cleaning',
            'medical',
            'dental',
            'legal',
            'restaurant',
            'retail',
            'automotive',
            'construction',
            'real-estate'
        ],
        default: 'general',
        required: true,
        index: true
    },
    
    // ========================================================================
    // TEMPLATE CONTENT
    // ========================================================================
    
    // Array of trigger variations
    triggers: [{
        type: String,
        trim: true,
        lowercase: true,
        required: true
    }],
    
    // The response text (can include placeholders like [Company Name])
    response: {
        type: String,
        required: true,
        trim: true
    },
    
    // Description of what this template does
    description: {
        type: String,
        trim: true
    },
    
    // ========================================================================
    // METADATA
    // ========================================================================
    
    // System template (pre-built by platform) vs user-created
    isSystemTemplate: {
        type: Boolean,
        default: false,
        index: true
    },
    
    // Usage tracking
    usageCount: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Companies using this template (for analytics)
    usedByCompanies: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company'
    }],
    
    // ========================================================================
    // AUDIT TRAIL
    // ========================================================================
    
    createdBy: {
        type: String,
        trim: true
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true,
        index: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    // Tags for additional filtering
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }]
    
}, {
    timestamps: true,  // Auto-manage createdAt/updatedAt
    collection: 'instantResponseTemplates'
});

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for filtering by category + industry
InstantResponseTemplateSchema.index({ category: 1, industry: 1 });

// Index for searching by name
InstantResponseTemplateSchema.index({ name: 'text', description: 'text' });

// ============================================================================
// METHODS
// ============================================================================

/**
 * Increment usage count when a company uses this template
 */
InstantResponseTemplateSchema.methods.incrementUsage = async function(companyId) {
    this.usageCount += 1;
    if (companyId && !this.usedByCompanies.includes(companyId)) {
        this.usedByCompanies.push(companyId);
    }
    this.updatedAt = new Date();
    return this.save();
};

/**
 * Convert to company instant response format
 */
InstantResponseTemplateSchema.methods.toCompanyFormat = function(companyName = null) {
    const instantResponses = [];
    
    this.triggers.forEach(trigger => {
        instantResponses.push({
            trigger: trigger,
            response: companyName 
                ? this.response.replace(/\[Company Name\]/g, companyName)
                : this.response,
            matchType: 'word-boundary',
            category: this.category,
            isActive: true,
            notes: `Imported from template: ${this.name}`,
            stats: {
                totalMatches: 0,
                lastTriggered: null,
                avgResponseTime: null
            }
        });
    });
    
    return instantResponses;
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get templates by industry and category
 */
InstantResponseTemplateSchema.statics.findByIndustryAndCategory = function(industry, category) {
    const query = { isSystemTemplate: true };
    
    if (industry && industry !== 'all') {
        query.$or = [
            { industry: industry },
            { industry: 'general' }  // Include general templates for all industries
        ];
    }
    
    if (category && category !== 'all') {
        query.category = category;
    }
    
    return this.find(query).sort({ usageCount: -1, name: 1 });
};

/**
 * Get most popular templates
 */
InstantResponseTemplateSchema.statics.findMostPopular = function(limit = 10) {
    return this.find({ isSystemTemplate: true })
        .sort({ usageCount: -1 })
        .limit(limit);
};

module.exports = mongoose.model('InstantResponseTemplate', InstantResponseTemplateSchema);
```

---

## 🔧 BACKEND COMPONENTS

### **Component 1: Variation Dictionary**

**File:** `/config/instantResponseVariations.js` (NEW)

```javascript
// ============================================================================
// INSTANT RESPONSE VARIATIONS DICTIONARY
// 📋 DESCRIPTION: Built-in dictionary of common trigger variations
// 🎯 PURPOSE: Provide in-house variation suggestions (no external LLM)
// 🔧 FEATURES:
//     - 7 pre-defined categories with 100+ variations
//     - Response templates for each category
//     - Typo/misspelling variations
//     - Industry-neutral (works for all business types)
// 📝 FUTURE EXPANSION:
//     - Add more categories based on real usage
//     - Industry-specific variations
//     - Multi-language support
// ⚠️  CRITICAL NOTES:
//     - All variations are lowercase
//     - No external API calls - 100% local
//     - Levenshtein distance used for typo detection
// ============================================================================

module.exports = {
    
    // ========================================================================
    // CATEGORY: GREETING
    // ========================================================================
    greeting: {
        base: ['hello', 'hi', 'hey'],
        variations: [
            // Standard greetings
            'hello',
            'hi',
            'hey',
            'hey there',
            'hi there',
            'hello there',
            
            // Time-based greetings
            'good morning',
            'good afternoon',
            'good evening',
            'morning',
            'afternoon',
            'evening',
            
            // Casual greetings
            'howdy',
            'greetings',
            'yo',
            'what\'s up',
            'sup',
            'wassup',
            'whats up',
            
            // Enthusiastic variations
            'hiya',
            'heya',
            'heyy',
            'hiii',
            'helloo'
        ],
        typos: [
            'helo',
            'hllo',
            'hii',
            'heyy',
            'heya',
            'mmhello'
        ],
        response_templates: [
            'Hi! How can I help you today?',
            'Hello! Thanks for calling [Company Name]. How may I assist you?',
            'Good [TIME]! What can I do for you today?',
            'Hey there! Welcome to [Company Name]. How can I help?',
            'Hi! Thanks for reaching out. What brings you in today?'
        ],
        description: 'Standard greeting responses for callers saying hello'
    },
    
    // ========================================================================
    // CATEGORY: HUMAN REQUEST
    // ========================================================================
    'human-request': {
        base: ['person', 'human', 'someone', 'transfer'],
        variations: [
            // Direct requests
            'person',
            'human',
            'someone',
            'transfer',
            'representative',
            'rep',
            'agent',
            'operator',
            'staff',
            'employee',
            
            // Phrased requests
            'speak to someone',
            'talk to someone',
            'speak with someone',
            'talk with someone',
            'speak to a person',
            'talk to a person',
            'speak to a human',
            'talk to a human',
            'real person',
            'actual person',
            'live person',
            'connect me',
            'transfer me',
            
            // Questions
            'can i speak to someone',
            'can i talk to someone',
            'is there someone',
            'is anyone there',
            'anyone there',
            
            // Frustrated variations
            'real human',
            'actual human',
            'not a robot',
            'not ai',
            'not a bot'
        ],
        response_templates: [
            'I\'d be happy to connect you with a team member. One moment please.',
            'Let me transfer you to someone who can assist you directly.',
            'I understand. I\'ll connect you with our team right away.',
            'Of course! I\'ll transfer you to a live representative now.',
            'Let me get someone on the line for you. Please hold briefly.'
        ],
        description: 'Requests to speak with a human/transfer to staff'
    },
    
    // ========================================================================
    // CATEGORY: EMERGENCY
    // ========================================================================
    emergency: {
        base: ['emergency', 'urgent', 'asap', 'now'],
        variations: [
            // Emergency terms
            'emergency',
            'urgent',
            'asap',
            'right now',
            'immediately',
            'right away',
            
            // Help requests
            'help',
            'need help',
            'urgent help',
            'emergency help',
            'need help now',
            'help me now',
            'help me please',
            
            // Severity indicators
            'critical',
            'serious',
            'life threatening',
            'danger',
            'dangerous',
            'can\'t wait',
            'cannot wait',
            
            // Specific emergencies (customize per industry)
            'no heat',
            'no air',
            'no ac',
            'no power',
            'flooding',
            'leak',
            'big leak',
            'water everywhere'
        ],
        response_templates: [
            'This sounds urgent. Let me connect you to our emergency team immediately.',
            'I understand this is urgent. Connecting you to emergency services now.',
            'Emergency assistance on the way. Transferring you immediately.',
            'I\'ll get you to our emergency team right away. Please hold.',
            'This is a priority. Connecting you to someone who can help immediately.'
        ],
        description: 'Emergency or urgent situation requests'
    },
    
    // ========================================================================
    // CATEGORY: HOURS
    // ========================================================================
    hours: {
        base: ['hours', 'open', 'closed', 'when'],
        variations: [
            // Hours queries
            'hours',
            'business hours',
            'operating hours',
            'store hours',
            'office hours',
            'your hours',
            'what are your hours',
            
            // Open/closed queries
            'open',
            'closed',
            'are you open',
            'are you closed',
            'open today',
            'closed today',
            'open tomorrow',
            'open now',
            
            // Time queries
            'what time',
            'what time open',
            'what time close',
            'when do you open',
            'when do you close',
            'when are you open',
            
            // Day-specific
            'open saturday',
            'open sunday',
            'weekend hours',
            'weekday hours',
            
            // Schedule queries
            'schedule',
            'availability',
            'available'
        ],
        response_templates: [
            'We\'re open [HOURS]. How can I help you today?',
            'Our business hours are [HOURS]. Is there anything I can assist with?',
            'We\'re currently [OPEN/CLOSED]. We\'ll be open [NEXT_OPEN_TIME].',
            'Our hours are [HOURS]. Would you like to schedule an appointment?',
            'We operate [HOURS]. What can I do for you?'
        ],
        description: 'Business hours and availability questions'
    },
    
    // ========================================================================
    // CATEGORY: LOCATION
    // ========================================================================
    location: {
        base: ['address', 'location', 'where', 'directions'],
        variations: [
            // Address queries
            'address',
            'your address',
            'street address',
            'mailing address',
            
            // Location queries
            'location',
            'where are you',
            'where are you located',
            'where is your',
            'where do i go',
            'find you',
            'locate you',
            
            // Direction queries
            'directions',
            'how do i get there',
            'how to get there',
            'route',
            'navigation',
            
            // Geographic queries
            'city',
            'town',
            'zip code',
            'postal code',
            'area',
            'region',
            'neighborhood'
        ],
        response_templates: [
            'We\'re located at [ADDRESS]. Would you like directions?',
            'Our address is [ADDRESS]. Can I help with anything else?',
            'You can find us at [ADDRESS]. We\'re looking forward to seeing you!',
            'We\'re at [ADDRESS]. I can text you directions if you\'d like.',
            '[ADDRESS]. Let me know if you need help finding us!'
        ],
        description: 'Address and location questions'
    },
    
    // ========================================================================
    // CATEGORY: PRICING
    // ========================================================================
    pricing: {
        base: ['price', 'cost', 'quote', 'how much'],
        variations: [
            // Price queries
            'price',
            'prices',
            'pricing',
            'cost',
            'costs',
            'how much',
            'how much does it cost',
            'what does it cost',
            
            // Quote requests
            'quote',
            'estimate',
            'free quote',
            'free estimate',
            'get a quote',
            'get an estimate',
            
            // Rate queries
            'rates',
            'rate',
            'fee',
            'fees',
            'charge',
            'charges',
            
            // Budget queries
            'expensive',
            'cheap',
            'affordable',
            'budget',
            'payment',
            'pay',
            
            // Comparison
            'how much for',
            'what\'s the price',
            'what\'s the cost'
        ],
        response_templates: [
            'I\'d be happy to connect you with someone who can provide accurate pricing.',
            'Let me transfer you to get a detailed quote for your specific needs.',
            'Pricing varies by service. Let me connect you with our team for an accurate estimate.',
            'I\'ll get you to someone who can discuss pricing and options with you.',
            'Great question! Let me transfer you to our team for a custom quote.'
        ],
        description: 'Pricing and cost inquiries'
    },
    
    // ========================================================================
    // CATEGORY: GOODBYE
    // ========================================================================
    goodbye: {
        base: ['bye', 'goodbye', 'thanks', 'thank you'],
        variations: [
            // Standard goodbyes
            'bye',
            'goodbye',
            'bye bye',
            'see you',
            'see ya',
            'talk to you later',
            'ttyl',
            
            // Thanks
            'thanks',
            'thank you',
            'thank you so much',
            'thanks a lot',
            'appreciate it',
            'thanks for your help',
            'thank you for your help',
            
            // Polite closings
            'have a good day',
            'have a great day',
            'have a nice day',
            'take care',
            'good day',
            
            // Done/finished
            'that\'s all',
            'that\'s it',
            'all set',
            'i\'m good',
            'we\'re good',
            'all done'
        ],
        response_templates: [
            'You\'re welcome! Have a great day!',
            'Thank you for calling [Company Name]. Have a wonderful day!',
            'My pleasure! Feel free to call anytime. Goodbye!',
            'Thanks for calling! Take care!',
            'Have a great day! We\'re here if you need anything.'
        ],
        description: 'Closing and thank you responses'
    },
    
    // ========================================================================
    // CATEGORY: CUSTOM
    // ========================================================================
    custom: {
        base: [],
        variations: [],
        response_templates: [
            'I understand. How can I assist you with that?',
            'Let me help you with that. Can you tell me more?',
            'I\'m here to help. What do you need?'
        ],
        description: 'Custom user-defined responses'
    }
};
```

### **Component 2: Variation Suggestion Engine**

**File:** `/services/variationSuggestionEngine.js` (NEW)

```javascript
// ============================================================================
// VARIATION SUGGESTION ENGINE
// 📋 DESCRIPTION: In-house variation suggester (NO external LLM)
// 🎯 PURPOSE: Suggest trigger variations using built-in dictionary
// 🔧 FEATURES:
//     - Category detection from trigger
//     - Variation suggestions from dictionary
//     - Response template suggestions
//     - Typo detection using Levenshtein distance
//     - 100% in-house, no external API calls
// 📝 PERFORMANCE:
//     - Category detection: < 1ms
//     - Variation lookup: < 1ms
//     - Typo detection: < 5ms
// ⚠️  CRITICAL NOTES:
//     - All processing is synchronous and local
//     - No network calls, no LLM, no external dependencies
//     - Levenshtein distance threshold = 2 (catches most typos)
// ============================================================================

const variationDictionary = require('../config/instantResponseVariations');
const logger = require('../utils/logger');

class VariationSuggestionEngine {
    
    /**
     * 🧠 Suggest variations for a trigger (IN-HOUSE, NO LLM)
     * @param {string} trigger - The trigger word/phrase
     * @returns {Object} Suggested variations, category, and response templates
     */
    static suggestVariations(trigger) {
        const startTime = Date.now();
        const triggerLower = trigger.toLowerCase().trim();
        
        logger.info(`[VARIATION ENGINE] Suggesting variations for: "${triggerLower}"`);
        
        try {
            // Step 1: Detect category by checking if trigger matches any base words
            const detectedCategory = this.detectCategory(triggerLower);
            
            if (detectedCategory) {
                const categoryData = variationDictionary[detectedCategory];
                const processingTime = Date.now() - startTime;
                
                logger.info(`[VARIATION ENGINE] ✅ Category detected: ${detectedCategory} (${processingTime}ms)`);
                
                return {
                    success: true,
                    category: detectedCategory,
                    categoryDescription: categoryData.description,
                    suggestedVariations: categoryData.variations,
                    suggestedTypos: categoryData.typos || [],
                    suggestedResponses: categoryData.response_templates,
                    confidence: 'high',
                    source: 'in-house-dictionary',
                    processingTime: `${processingTime}ms`
                };
            }
            
            // Step 2: No exact category match - try similarity matching
            const similarWords = this.findSimilarWords(triggerLower);
            const processingTime = Date.now() - startTime;
            
            if (similarWords.length > 0) {
                logger.info(`[VARIATION ENGINE] ⚠️ No exact category, found ${similarWords.length} similar words (${processingTime}ms)`);
                
                return {
                    success: true,
                    category: 'custom',
                    categoryDescription: 'Custom user-defined response',
                    suggestedVariations: [triggerLower, ...similarWords],
                    suggestedTypos: [],
                    suggestedResponses: variationDictionary.custom.response_templates,
                    confidence: 'medium',
                    source: 'similarity-matching',
                    processingTime: `${processingTime}ms`
                };
            }
            
            // Step 3: No matches at all - return minimal suggestion
            logger.info(`[VARIATION ENGINE] ⚠️ No matches found for "${triggerLower}" (${processingTime}ms)`);
            
            return {
                success: true,
                category: 'custom',
                categoryDescription: 'Custom user-defined response',
                suggestedVariations: [triggerLower],
                suggestedTypos: [],
                suggestedResponses: variationDictionary.custom.response_templates,
                confidence: 'low',
                source: 'no-match',
                processingTime: `${processingTime}ms`
            };
            
        } catch (error) {
            logger.error(`[VARIATION ENGINE] ❌ Error suggesting variations:`, error);
            return {
                success: false,
                error: error.message,
                category: 'custom',
                suggestedVariations: [triggerLower],
                suggestedResponses: [],
                confidence: 'error'
            };
        }
    }
    
    /**
     * 🔍 Detect category from trigger
     * @param {string} trigger - The trigger (lowercase)
     * @returns {string|null} Category name or null
     */
    static detectCategory(trigger) {
        for (const [category, data] of Object.entries(variationDictionary)) {
            if (category === 'custom') continue;  // Skip custom category
            
            // Check if trigger matches any base word
            if (data.base && data.base.length > 0) {
                for (const baseWord of data.base) {
                    if (trigger === baseWord || trigger.includes(baseWord)) {
                        return category;
                    }
                }
            }
            
            // Check if trigger matches any variation exactly
            if (data.variations && data.variations.includes(trigger)) {
                return category;
            }
            
            // Check if trigger matches any typo
            if (data.typos && data.typos.includes(trigger)) {
                return category;
            }
        }
        
        return null;
    }
    
    /**
     * 🔎 Find similar words using simple string matching
     * @param {string} trigger - The trigger (lowercase)
     * @returns {Array<string>} Array of similar words
     */
    static findSimilarWords(trigger) {
        const similar = [];
        const maxResults = 10;
        
        for (const [category, data] of Object.entries(variationDictionary)) {
            if (category === 'custom') continue;
            
            for (const variation of data.variations) {
                if (this.areSimilar(trigger, variation)) {
                    similar.push(variation);
                    if (similar.length >= maxResults) break;
                }
            }
            
            if (similar.length >= maxResults) break;
        }
        
        // Remove duplicates
        return [...new Set(similar)];
    }
    
    /**
     * 📊 Simple similarity check (no LLM)
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {boolean} True if similar
     */
    static areSimilar(str1, str2) {
        // Exact match
        if (str1 === str2) return true;
        
        // One contains the other
        if (str1.includes(str2) || str2.includes(str1)) return true;
        
        // Levenshtein distance <= 2 (catches typos)
        if (this.levenshteinDistance(str1, str2) <= 2) return true;
        
        return false;
    }
    
    /**
     * 📏 Levenshtein distance (edit distance between two strings)
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Edit distance
     */
    static levenshteinDistance(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        
        // Create matrix
        const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(null));
        
        // Initialize first row and column
        for (let i = 0; i <= len1; i++) matrix[i][0] = i;
        for (let j = 0; j <= len2; j++) matrix[0][j] = j;
        
        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,  // substitution
                        matrix[i][j - 1] + 1,      // insertion
                        matrix[i - 1][j] + 1       // deletion
                    );
                }
            }
        }
        
        return matrix[len1][len2];
    }
    
    /**
     * 📋 Get all templates for a category
     * @param {string} category - Category name
     * @returns {Object} Variations and response templates
     */
    static getTemplatesForCategory(category) {
        if (!variationDictionary[category]) {
            return {
                variations: [],
                responses: [],
                description: 'Unknown category'
            };
        }
        
        const categoryData = variationDictionary[category];
        return {
            variations: categoryData.variations,
            responses: categoryData.response_templates,
            description: categoryData.description,
            typos: categoryData.typos || []
        };
    }
    
    /**
     * 🔄 Get all available categories
     * @returns {Array<string>} Category names
     */
    static getAllCategories() {
        return Object.keys(variationDictionary).filter(cat => cat !== 'custom');
    }
    
    /**
     * 📊 Get category statistics
     * @returns {Object} Statistics for all categories
     */
    static getCategoryStatistics() {
        const stats = {};
        
        for (const [category, data] of Object.entries(variationDictionary)) {
            if (category === 'custom') continue;
            
            stats[category] = {
                name: category,
                description: data.description,
                baseWords: data.base ? data.base.length : 0,
                variations: data.variations ? data.variations.length : 0,
                typos: data.typos ? data.typos.length : 0,
                responseTemplates: data.response_templates ? data.response_templates.length : 0
            };
        }
        
        return stats;
    }
}

module.exports = VariationSuggestionEngine;
```

**Continue in next message due to length...**
