/**
 * INSTANT RESPONSE CATEGORY MODEL
 * 
 * Purpose: Organize instant responses into categories (Empathy, Greetings, Waiting, etc.)
 * Each category contains multiple Q&As with trigger variations and advanced AI behavior
 * 
 * Structure:
 * - Category level: name, description, icon, color
 * - Q&A level: trigger variations array, response, keywords, timing, context awareness
 * 
 * Multi-tenant: All data scoped by companyId
 * 
 * Created: 2025-10-02
 */

const mongoose = require('mongoose');

// ============================================================================
// Q&A SUB-SCHEMA
// ============================================================================

const QnASchema = new mongoose.Schema({
  // Unique identifier for this Q&A
  id: {
    type: String,
    required: true,
    default: () => new mongoose.Types.ObjectId().toString()
  },

  // ⚡ TRIGGER VARIATIONS - Array of phrases that trigger this response
  triggers: {
    type: [String],
    required: true,
    validate: {
      validator: function(arr) {
        return arr && arr.length > 0 && arr.length <= 20;
      },
      message: 'Must have between 1 and 20 trigger variations'
    }
  },

  // 💬 RESPONSE VARIATIONS - Multiple responses to avoid sounding robotic
  // AI will rotate/randomize between these for natural conversation
  responses: {
    type: [String],
    required: true,
    validate: {
      validator: function(arr) {
        return arr && arr.length > 0 && arr.length <= 10 &&
               arr.every(r => r && r.trim().length >= 5 && r.trim().length <= 500);
      },
      message: 'Must have 1-10 responses, each 5-500 characters'
    }
  },

  // 🔄 ROTATION MODE - How to select response variation
  rotationMode: {
    type: String,
    enum: ['random', 'sequential', 'weighted'],
    default: 'random'
  },

  // 🔑 KEYWORDS - Auto-generated for fast matching
  keywords: {
    type: [String],
    default: []
  },

  // ⏱️ TIMING & FOLLOW-UP BEHAVIOR
  timing: {
    enabled: {
      type: Boolean,
      default: false
    },
    waitSeconds: {
      type: Number,
      default: 90,
      min: 10,
      max: 600
    },
    followUpMessage: {
      type: String,
      default: '',
      maxlength: 500
    },
    secondFollowUp: {
      enabled: {
        type: Boolean,
        default: false
      },
      waitSeconds: {
        type: Number,
        default: 120,
        min: 10,
        max: 600
      },
      message: {
        type: String,
        default: '',
        maxlength: 500
      }
    },
    maxFollowUps: {
      type: Number,
      default: 2,
      min: 1,
      max: 5
    },
    escalationAction: {
      type: String,
      enum: ['none', 'leave_voicemail', 'transfer', 'end_call'],
      default: 'none'
    },
    escalationMessage: {
      type: String,
      default: '',
      maxlength: 500
    }
  },

  // 🧠 CONTEXT AWARENESS
  contextAware: {
    type: Boolean,
    default: false
  },

  // 🎭 TONE VARIATION
  toneVariation: {
    enabled: {
      type: Boolean,
      default: false
    },
    tone: {
      type: String,
      enum: ['friendly', 'professional', 'empathetic', 'casual', 'formal'],
      default: 'friendly'
    }
  },

  // 📊 PRIORITY (higher = checked first)
  priority: {
    type: Number,
    default: 50,
    min: 1,
    max: 100
  },

  // ✅ STATUS
  enabled: {
    type: Boolean,
    default: true
  },

  // 📝 ADMIN NOTES
  notes: {
    type: String,
    default: '',
    maxlength: 1000
  },

  // 📊 USAGE STATS
  stats: {
    timesMatched: {
      type: Number,
      default: 0
    },
    lastMatched: {
      type: Date,
      default: null
    },
    successRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1
    }
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false }); // No separate _id for sub-documents

// ============================================================================
// CATEGORY SCHEMA
// ============================================================================

const InstantResponseCategorySchema = new mongoose.Schema({
  // 🏢 MULTI-TENANT: Company isolation
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'v2Company',
    required: true,
    index: true
  },

  // 📁 CATEGORY INFO
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },

  description: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 500
  },

  // 🎨 VISUAL CUSTOMIZATION
  icon: {
    type: String,
    default: '⚡'
  },

  color: {
    type: String,
    default: '#4F46E5',
    match: /^#[0-9A-F]{6}$/i
  },

  // 📋 Q&As ARRAY
  qnas: {
    type: [QnASchema],
    default: []
  },

  // 📊 CATEGORY STATS
  stats: {
    totalQnAs: {
      type: Number,
      default: 0
    },
    enabledQnAs: {
      type: Number,
      default: 0
    },
    totalTriggers: {
      type: Number,
      default: 0
    },
    lastModified: {
      type: Date,
      default: Date.now
    }
  },

  // ✅ STATUS
  enabled: {
    type: Boolean,
    default: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'instantresponsecategories'
});

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for fast category lookup by company
InstantResponseCategorySchema.index({ companyId: 1, name: 1 });

// Index for enabled categories
InstantResponseCategorySchema.index({ companyId: 1, enabled: 1 });

// Text index for searching triggers and responses
InstantResponseCategorySchema.index({ 
  'qnas.triggers': 'text', 
  'qnas.responses': 'text',
  name: 'text',
  description: 'text'
});

// ============================================================================
// PRE-SAVE MIDDLEWARE
// ============================================================================

InstantResponseCategorySchema.pre('save', function(next) {
  // Update stats before saving
  this.stats.totalQnAs = this.qnas.length;
  this.stats.enabledQnAs = this.qnas.filter(q => q.enabled).length;
  this.stats.totalTriggers = this.qnas.reduce((sum, q) => sum + q.triggers.length, 0);
  this.stats.lastModified = new Date();
  this.updatedAt = new Date();
  
  // Update Q&A timestamps
  this.qnas.forEach(qna => {
    qna.updatedAt = new Date();
  });
  
  next();
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Find Q&A by ID
 */
InstantResponseCategorySchema.methods.findQnAById = function(qnaId) {
  return this.qnas.find(q => q.id === qnaId);
};

/**
 * Add new Q&A
 */
InstantResponseCategorySchema.methods.addQnA = function(qnaData) {
  const newQnA = {
    id: new mongoose.Types.ObjectId().toString(),
    ...qnaData,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  this.qnas.push(newQnA);
  return newQnA;
};

/**
 * Update Q&A by ID
 */
InstantResponseCategorySchema.methods.updateQnA = function(qnaId, updates) {
  const qna = this.findQnAById(qnaId);
  if (!qna) return null;
  
  Object.assign(qna, updates);
  qna.updatedAt = new Date();
  return qna;
};

/**
 * Delete Q&A by ID
 */
InstantResponseCategorySchema.methods.deleteQnA = function(qnaId) {
  const index = this.qnas.findIndex(q => q.id === qnaId);
  if (index === -1) return false;
  
  this.qnas.splice(index, 1);
  return true;
};

/**
 * Get all enabled Q&As sorted by priority
 */
InstantResponseCategorySchema.methods.getEnabledQnAs = function() {
  return this.qnas
    .filter(q => q.enabled)
    .sort((a, b) => b.priority - a.priority);
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get all categories for a company with stats
 */
InstantResponseCategorySchema.statics.getCompanyCategories = async function(companyId, includeDisabled = false) {
  const query = { companyId };
  if (!includeDisabled) {
    query.enabled = true;
  }
  
  return this.find(query).sort({ name: 1 }).lean();
};

/**
 * Search Q&As across all categories
 */
InstantResponseCategorySchema.statics.searchQnAs = async function(companyId, searchTerm) {
  return this.find({
    companyId,
    $text: { $search: searchTerm }
  }).lean();
};

// ============================================================================
// Q&A HELPER METHODS
// ============================================================================

/**
 * 🎲 Select a response variation intelligently
 * Avoids repetition by tracking recently used responses within a call session
 * 
 * @param {Object} qna - Q&A object with responses array
 * @param {Array} recentlyUsed - Array of recently used response indices (optional)
 * @returns {String} - Selected response
 */
QnASchema.methods.selectResponse = function(recentlyUsed = []) {
  if (!this.responses || this.responses.length === 0) {
    return "I'm here to help!"; // Emergency fallback
  }

  // If only one response, return it
  if (this.responses.length === 1) {
    return this.responses[0];
  }

  // Filter out recently used responses (if within same call)
  const availableIndices = [];
  for (let i = 0; i < this.responses.length; i++) {
    if (!recentlyUsed.includes(i)) {
      availableIndices.push(i);
    }
  }

  // If all responses were used recently, reset and use any
  const indicesToChooseFrom = availableIndices.length > 0 
    ? availableIndices 
    : Array.from({ length: this.responses.length }, (_, i) => i);

  // Select based on rotation mode
  let selectedIndex;
  
  switch (this.rotationMode) {
    case 'sequential':
      // Use the next one in sequence
      const lastUsed = recentlyUsed[recentlyUsed.length - 1] || -1;
      selectedIndex = (lastUsed + 1) % this.responses.length;
      break;
      
    case 'weighted':
      // Prefer responses that haven't been used as much (future enhancement)
      selectedIndex = indicesToChooseFrom[0];
      break;
      
    case 'random':
    default:
      // Random selection from available responses
      selectedIndex = indicesToChooseFrom[Math.floor(Math.random() * indicesToChooseFrom.length)];
      break;
  }

  return this.responses[selectedIndex];
};

/**
 * 🎯 Get a specific response by index (for testing/debugging)
 */
QnASchema.methods.getResponseByIndex = function(index) {
  if (index >= 0 && index < this.responses.length) {
    return this.responses[index];
  }
  return this.responses[0]; // Default to first
};

// ============================================================================
// EXPORT MODEL
// ============================================================================

module.exports = mongoose.model('InstantResponseCategory', InstantResponseCategorySchema);

