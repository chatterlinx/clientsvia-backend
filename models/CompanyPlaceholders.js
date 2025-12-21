/**
 * ============================================================================
 * COMPANY PLACEHOLDERS MODEL
 * ============================================================================
 * 
 * PURPOSE: Clean, simple placeholder system (replaces old spaghetti Variables)
 * 
 * ARCHITECTURE:
 * - Simple 2-column structure: Name | Value
 * - Per companyId (multi-tenant safe)
 * - Used for template rendering: {companyname}, {phone}, {license}, etc.
 * - NO nesting, NO logic, NO scripting
 * 
 * USAGE IN REPLIES:
 * "Thank you for calling {companyname}! Our technicians are licensed: {license}"
 * → "Thank you for calling Penguin Air! Our technicians are licensed: #ROC123456"
 * 
 * RENDERING RULES:
 * - If placeholder exists → substitute value
 * - If placeholder missing → leave as-is OR remove gracefully
 * - NEVER show "undefined"
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PlaceholderSchema = new Schema({
    // Placeholder key (lowercase, no braces)
    // e.g., "companyname", "phone", "license", "servicearea"
    key: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 50
    },
    
    // Placeholder value
    value: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    
    // Optional description for admin UI
    description: {
        type: String,
        default: null,
        maxlength: 200
    },
    
    // Is this a system placeholder? (auto-populated from company data)
    isSystem: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const CompanyPlaceholdersSchema = new Schema({
    // ═══════════════════════════════════════════════════════════════════
    // IDENTITY (Multi-tenant safe)
    // ═══════════════════════════════════════════════════════════════════
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        unique: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // PLACEHOLDERS
    // ═══════════════════════════════════════════════════════════════════
    placeholders: {
        type: [PlaceholderSchema],
        default: []
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // AUDIT
    // ═══════════════════════════════════════════════════════════════════
    lastUpdatedBy: {
        type: String,
        default: null
    }
    
}, {
    timestamps: true,
    collection: 'companyPlaceholders'
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get placeholders as a Map for O(1) lookup
 */
CompanyPlaceholdersSchema.statics.getPlaceholdersMap = async function(companyId) {
    const doc = await this.findOne({ companyId }).lean();
    const map = new Map();
    
    if (doc?.placeholders) {
        for (const p of doc.placeholders) {
            map.set(p.key.toLowerCase(), p.value);
        }
    }
    
    return map;
};

/**
 * Get or create placeholders document for a company
 */
CompanyPlaceholdersSchema.statics.getOrCreate = async function(companyId) {
    let doc = await this.findOne({ companyId });
    
    if (!doc) {
        // Create with empty placeholders array
        doc = await this.create({ 
            companyId, 
            placeholders: []
        });
    }
    
    return doc;
};

/**
 * Get placeholders as simple array (for UI)
 */
CompanyPlaceholdersSchema.statics.getPlaceholdersList = async function(companyId) {
    const doc = await this.findOne({ companyId }).lean();
    return doc?.placeholders || [];
};

/**
 * Set a single placeholder
 */
CompanyPlaceholdersSchema.statics.setPlaceholder = async function(companyId, key, value, options = {}) {
    const { description, isSystem = false, updatedBy } = options;
    const normalizedKey = key.toLowerCase().trim();
    
    // Find or create document
    let doc = await this.findOne({ companyId });
    if (!doc) {
        doc = new this({ companyId, placeholders: [] });
    }
    
    // Find existing placeholder
    const existingIndex = doc.placeholders.findIndex(p => p.key === normalizedKey);
    
    if (existingIndex !== -1) {
        // Update existing
        doc.placeholders[existingIndex].value = value;
        if (description !== undefined) {
            doc.placeholders[existingIndex].description = description;
        }
    } else {
        // Add new
        doc.placeholders.push({
            key: normalizedKey,
            value,
            description: description || null,
            isSystem
        });
    }
    
    doc.lastUpdatedBy = updatedBy || null;
    await doc.save();
    
    return doc;
};

/**
 * Remove a placeholder
 */
CompanyPlaceholdersSchema.statics.removePlaceholder = async function(companyId, key) {
    const normalizedKey = key.toLowerCase().trim();
    
    return this.findOneAndUpdate(
        { companyId },
        {
            $pull: { placeholders: { key: normalizedKey } }
        },
        { new: true }
    );
};

/**
 * Bulk set placeholders (replaces all)
 */
CompanyPlaceholdersSchema.statics.setAllPlaceholders = async function(companyId, placeholders, updatedBy = null) {
    // Normalize keys
    const normalizedPlaceholders = placeholders.map(p => ({
        key: p.key.toLowerCase().trim(),
        value: p.value,
        description: p.description || null,
        isSystem: p.isSystem || false
    }));
    
    return this.findOneAndUpdate(
        { companyId },
        {
            $set: {
                placeholders: normalizedPlaceholders,
                lastUpdatedBy: updatedBy
            }
        },
        { upsert: true, new: true }
    );
};

/**
 * Get summary for Flow Tree snapshot
 */
CompanyPlaceholdersSchema.statics.getSummary = async function(companyId) {
    const doc = await this.findOne({ companyId }).lean();
    
    if (!doc) {
        return {
            count: 0,
            keys: [],
            lastUpdated: null
        };
    }
    
    return {
        count: doc.placeholders.length,
        keys: doc.placeholders.map(p => p.key),
        lastUpdated: doc.updatedAt
    };
};

/**
 * Render text with placeholders
 * @param {String} text - Text with {placeholder} tokens
 * @param {Map|Object} placeholdersMap - Map or object of key->value
 * @returns {String} - Rendered text
 */
CompanyPlaceholdersSchema.statics.render = function(text, placeholdersMap) {
    if (!text) return text;
    
    // Convert to Map if needed
    const map = placeholdersMap instanceof Map 
        ? placeholdersMap 
        : new Map(Object.entries(placeholdersMap || {}));
    
    // Replace all {placeholder} tokens
    return text.replace(/\{([^}]+)\}/g, (match, key) => {
        const normalizedKey = key.toLowerCase().trim();
        const value = map.get(normalizedKey);
        
        // If value exists, use it. Otherwise, keep original token.
        return value !== undefined && value !== null ? value : match;
    });
};

module.exports = mongoose.model('CompanyPlaceholders', CompanyPlaceholdersSchema);

