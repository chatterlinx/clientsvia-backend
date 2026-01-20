/**
 * ============================================================================
 * VENDOR MODEL - Supply Houses, Delivery Services, Partners
 * ============================================================================
 * 
 * PURPOSE:
 * Track non-customer callers who interact with the business:
 * - Supply houses (Tropic Supply, Johnstone, Carrier)
 * - Delivery services (UPS, FedEx, USPS, local couriers)
 * - Partners (warranty companies, inspectors, property managers)
 * 
 * MULTI-TENANT: Always scoped by companyId.
 * 
 * USE CASES:
 * 1. "Tropic Supply - your motor for Johnson is ready, PO# 123"
 *    → AI extracts vendor, links to customer, creates pickup card
 * 
 * 2. "UPS, package for Penguin Air, need signature"
 *    → AI logs delivery, asks for ETA, creates delivery card
 * 
 * 3. "This is the warranty company calling about claim #456"
 *    → AI logs, links to customer, creates follow-up card
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// --- Sub-schema for Contact Person ---
const vendorContactSchema = new Schema({
    name: { type: String, trim: true },
    role: { type: String, trim: true }, // "Counter Rep", "Driver", "Account Manager"
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    isPrimary: { type: Boolean, default: false },
    notes: { type: String, trim: true }
}, { _id: true });

// --- Sub-schema for Account Info ---
const vendorAccountSchema = new Schema({
    accountNumber: { type: String, trim: true },
    creditLimit: { type: Number },
    paymentTerms: { type: String, trim: true }, // "Net 30", "COD", "Credit Card"
    taxExempt: { type: Boolean, default: false },
    taxExemptNumber: { type: String, trim: true },
    notes: { type: String, trim: true }
}, { _id: false });

// --- Main Vendor Schema ---
const vendorSchema = new Schema({
    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-TENANT ISOLATION (Required)
    // ═══════════════════════════════════════════════════════════════════════════
    companyId: { 
        type: Schema.Types.ObjectId, 
        ref: 'v2Company', 
        required: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // VENDOR IDENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    name: { 
        type: String, 
        trim: true, 
        required: true 
    },
    
    type: {
        type: String,
        enum: [
            'supply_house',      // Parts suppliers (Tropic Supply, Johnstone)
            'delivery',          // Delivery services (UPS, FedEx, USPS)
            'manufacturer',      // Equipment manufacturers (Carrier, Trane)
            'warranty',          // Warranty companies
            'inspector',         // City inspectors, code enforcement
            'property_manager',  // Property management companies
            'contractor',        // Sub-contractors, partners
            'utility',           // FPL, gas company
            'other'
        ],
        default: 'other'
    },
    
    // Common aliases (for AI recognition)
    aliases: [{
        type: String,
        trim: true,
        lowercase: true
    }], // ["tropic", "tropic supply", "tropical supply"]
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CONTACT INFORMATION
    // ═══════════════════════════════════════════════════════════════════════════
    phoneNumbers: [{
        number: { type: String, trim: true, required: true },
        label: { type: String, trim: true, default: 'Main' }, // Main, Parts Counter, Delivery
        isPrimary: { type: Boolean, default: false }
    }],
    
    email: { type: String, trim: true, lowercase: true },
    website: { type: String, trim: true },
    
    address: {
        street: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        zip: { type: String, trim: true }
    },
    
    // Individual contacts at the vendor
    contacts: [vendorContactSchema],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT & BUSINESS INFO
    // ═══════════════════════════════════════════════════════════════════════════
    account: { type: vendorAccountSchema, default: () => ({}) },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AI RECOGNITION
    // ═══════════════════════════════════════════════════════════════════════════
    // Phrases the AI uses to identify this vendor
    recognitionPhrases: [{
        type: String,
        trim: true,
        lowercase: true
    }], // ["this is tropic supply", "calling from tropic", "tropic supply calling"]
    
    // Default handling instructions for AI
    aiInstructions: {
        defaultGreeting: { type: String, trim: true },
        // "Hi! Thanks for calling. What's the update?"
        
        askForPONumber: { type: Boolean, default: true },
        askForCustomerName: { type: Boolean, default: true },
        askForPartDescription: { type: Boolean, default: true },
        askForETA: { type: Boolean, default: false }, // For delivery
        
        customQuestions: [{
            question: { type: String, trim: true },
            required: { type: Boolean, default: false }
        }]
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RELATIONSHIP METRICS
    // ═══════════════════════════════════════════════════════════════════════════
    metrics: {
        totalCalls: { type: Number, default: 0 },
        lastCallAt: { type: Date },
        totalOrders: { type: Number, default: 0 },
        totalSpend: { type: Number, default: 0 }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STATUS & NOTES
    // ═══════════════════════════════════════════════════════════════════════════
    status: {
        type: String,
        enum: ['active', 'inactive', 'blocked'],
        default: 'active'
    },
    
    tags: [{ type: String, trim: true }], // "preferred", "local", "24-hour"
    
    notes: { type: String, trim: true },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIMESTAMPS
    // ═══════════════════════════════════════════════════════════════════════════
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
    
}, { 
    timestamps: true,
    collection: 'vendors'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Primary lookup: company + phone
vendorSchema.index({ companyId: 1, 'phoneNumbers.number': 1 });

// Lookup by name
vendorSchema.index({ companyId: 1, name: 1 });

// Lookup by type
vendorSchema.index({ companyId: 1, type: 1 });

// Text search on name and aliases
vendorSchema.index({ companyId: 1, name: 'text', aliases: 'text' });

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find vendor by phone number
 */
vendorSchema.statics.findByPhone = async function(companyId, phone) {
    const normalized = phone.replace(/\D/g, '');
    return this.findOne({
        companyId,
        'phoneNumbers.number': { $regex: normalized.slice(-10) }
    });
};

/**
 * Find vendor by name or alias (fuzzy)
 */
vendorSchema.statics.findByNameOrAlias = async function(companyId, searchTerm) {
    const normalized = searchTerm.toLowerCase().trim();
    
    // Exact match first
    let vendor = await this.findOne({
        companyId,
        $or: [
            { name: { $regex: normalized, $options: 'i' } },
            { aliases: normalized }
        ]
    });
    
    if (vendor) return vendor;
    
    // Try recognition phrases
    vendor = await this.findOne({
        companyId,
        recognitionPhrases: { $elemMatch: { $regex: normalized, $options: 'i' } }
    });
    
    return vendor;
};

/**
 * Find or create vendor from call context
 */
vendorSchema.statics.findOrCreateFromCall = async function(companyId, { phone, name, type }) {
    // Try to find by phone first
    let vendor = await this.findByPhone(companyId, phone);
    
    if (vendor) {
        // Update last call time
        vendor.metrics.totalCalls = (vendor.metrics.totalCalls || 0) + 1;
        vendor.metrics.lastCallAt = new Date();
        await vendor.save();
        return { vendor, isNew: false };
    }
    
    // Try by name
    if (name) {
        vendor = await this.findByNameOrAlias(companyId, name);
        if (vendor) {
            // Add this phone number
            if (phone && !vendor.phoneNumbers.some(p => p.number.includes(phone.slice(-10)))) {
                vendor.phoneNumbers.push({ number: phone, label: 'Unknown', isPrimary: false });
            }
            vendor.metrics.totalCalls = (vendor.metrics.totalCalls || 0) + 1;
            vendor.metrics.lastCallAt = new Date();
            await vendor.save();
            return { vendor, isNew: false };
        }
    }
    
    // Create new vendor
    vendor = await this.create({
        companyId,
        name: name || 'Unknown Vendor',
        type: type || 'other',
        phoneNumbers: phone ? [{ number: phone, label: 'Main', isPrimary: true }] : [],
        metrics: {
            totalCalls: 1,
            lastCallAt: new Date()
        }
    });
    
    return { vendor, isNew: true };
};

/**
 * Get common vendors (supply houses, delivery) for quick recognition
 */
vendorSchema.statics.getCommonVendors = async function(companyId) {
    return this.find({
        companyId,
        status: 'active',
        type: { $in: ['supply_house', 'delivery', 'manufacturer'] }
    })
        .select('name aliases recognitionPhrases type phoneNumbers')
        .lean();
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the primary phone number
 */
vendorSchema.methods.getPrimaryPhone = function() {
    const primary = this.phoneNumbers.find(p => p.isPrimary);
    return primary?.number || this.phoneNumbers[0]?.number || null;
};

/**
 * Get primary contact person
 */
vendorSchema.methods.getPrimaryContact = function() {
    return this.contacts.find(c => c.isPrimary) || this.contacts[0] || null;
};

/**
 * Check if text matches this vendor
 */
vendorSchema.methods.matchesText = function(text) {
    const normalized = text.toLowerCase();
    
    // Check name
    if (normalized.includes(this.name.toLowerCase())) return true;
    
    // Check aliases
    for (const alias of this.aliases || []) {
        if (normalized.includes(alias)) return true;
    }
    
    // Check recognition phrases
    for (const phrase of this.recognitionPhrases || []) {
        if (normalized.includes(phrase)) return true;
    }
    
    return false;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-BUILT VENDOR TEMPLATES (for seeding)
// ═══════════════════════════════════════════════════════════════════════════════

vendorSchema.statics.COMMON_VENDORS = {
    DELIVERY: [
        { name: 'UPS', type: 'delivery', aliases: ['ups', 'united parcel'], recognitionPhrases: ['ups delivery', 'this is ups', 'calling from ups'] },
        { name: 'FedEx', type: 'delivery', aliases: ['fedex', 'federal express'], recognitionPhrases: ['fedex delivery', 'this is fedex', 'calling from fedex'] },
        { name: 'USPS', type: 'delivery', aliases: ['usps', 'postal service', 'post office'], recognitionPhrases: ['postal service', 'this is usps'] },
        { name: 'Amazon', type: 'delivery', aliases: ['amazon'], recognitionPhrases: ['amazon delivery', 'delivery from amazon'] }
    ],
    SUPPLY_HOUSES: [
        { name: 'Tropic Supply', type: 'supply_house', aliases: ['tropic', 'tropical supply'], recognitionPhrases: ['tropic supply calling', 'this is tropic'] },
        { name: 'Johnstone Supply', type: 'supply_house', aliases: ['johnstone'], recognitionPhrases: ['johnstone supply calling', 'this is johnstone'] },
        { name: 'Ferguson', type: 'supply_house', aliases: ['ferguson'], recognitionPhrases: ['ferguson calling', 'this is ferguson'] },
        { name: 'Carrier Enterprise', type: 'supply_house', aliases: ['carrier', 'ce'], recognitionPhrases: ['carrier enterprise calling'] },
        { name: 'Gemaire', type: 'supply_house', aliases: ['gemaire'], recognitionPhrases: ['gemaire calling', 'this is gemaire'] }
    ]
};

/**
 * Seed common vendors for a company
 */
vendorSchema.statics.seedCommonVendors = async function(companyId) {
    const created = [];
    
    for (const vendor of [...this.COMMON_VENDORS.DELIVERY, ...this.COMMON_VENDORS.SUPPLY_HOUSES]) {
        const existing = await this.findOne({ companyId, name: vendor.name });
        if (!existing) {
            const newVendor = await this.create({
                companyId,
                ...vendor,
                aiInstructions: {
                    askForPONumber: vendor.type === 'supply_house',
                    askForCustomerName: vendor.type === 'supply_house',
                    askForPartDescription: vendor.type === 'supply_house',
                    askForETA: vendor.type === 'delivery'
                }
            });
            created.push(newVendor.name);
        }
    }
    
    return created;
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const Vendor = mongoose.model('Vendor', vendorSchema);

module.exports = Vendor;
