/**
 * ============================================================================
 * CALLER CLASSIFICATION SERVICE - Smart Caller Type Detection
 * ============================================================================
 * 
 * PURPOSE:
 * Automatically classify incoming callers into categories:
 * - Customer (Residential / Commercial)
 * - Vendor (Supply House / Delivery / Warranty / Other)
 * - Prospect (Potential new customer)
 * - Unknown
 * 
 * USED BY:
 * - AI Agent during conversation to adjust behavior
 * - Call Center dashboard for card organization
 * - KPI tracking for containment metrics
 * 
 * HOW IT WORKS:
 * 1. Check phone number against known customers/vendors
 * 2. Analyze caller's opening statement for patterns
 * 3. Listen for vendor-specific keywords (PO#, delivery, parts ready)
 * 4. Update classification as conversation progresses
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Customer = require('../models/Customer');
const Vendor = require('../models/Vendor');

// ============================================================================
// CLASSIFICATION TYPES
// ============================================================================

const CALLER_TYPES = {
    CUSTOMER: 'customer',
    VENDOR: 'vendor',
    PROSPECT: 'prospect',
    UNKNOWN: 'unknown'
};

const CALLER_SUB_TYPES = {
    // Customer sub-types
    RESIDENTIAL: 'residential',
    COMMERCIAL: 'commercial',
    
    // Vendor sub-types
    DELIVERY: 'delivery',
    SUPPLY_HOUSE: 'supply_house',
    WARRANTY: 'warranty',
    PROPERTY_MANAGER: 'property_manager',
    INSPECTOR: 'inspector',
    OTHER: 'other'
};

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

const VENDOR_PATTERNS = {
    // Delivery services
    DELIVERY: {
        keywords: [
            'ups', 'fedex', 'usps', 'postal', 'amazon', 'delivery', 'package',
            'parcel', 'shipment', 'courier', 'driver', 'drop off', 'drop-off',
            'signature required', 'leave at door'
        ],
        phrases: [
            'have a delivery', 'have a package', 'delivery for', 'package for',
            'need a signature', 'where should i leave', 'attempting delivery',
            'your package', 'shipment has arrived'
        ]
    },
    
    // Supply houses
    SUPPLY_HOUSE: {
        keywords: [
            'supply', 'parts', 'po number', 'purchase order', 'will call',
            'ready for pickup', 'pick up', 'motor', 'compressor', 'capacitor',
            'coil', 'thermostat', 'refrigerant', 'freon', 'equipment',
            'tropic', 'johnstone', 'ferguson', 'carrier', 'gemaire', 'baker'
        ],
        phrases: [
            'your order is ready', 'part is in', 'parts are in', 'ready for pickup',
            'your motor', 'your compressor', 'calling about an order',
            'your po number', 'purchase order', 'will call order',
            'equipment has arrived', 'special order'
        ]
    },
    
    // Warranty companies
    WARRANTY: {
        keywords: [
            'warranty', 'claim', 'authorization', 'approved', 'denied',
            'home warranty', 'first american', 'american home shield', 'ahs',
            '2-10', 'old republic', 'hsa', 'fidelity'
        ],
        phrases: [
            'warranty claim', 'claim number', 'authorization number',
            'claim has been', 'warranty company', 'calling about claim',
            'dispatch', 'work order'
        ]
    },
    
    // Property managers
    PROPERTY_MANAGER: {
        keywords: [
            'property manager', 'property management', 'landlord', 'tenant',
            'rental', 'apartment', 'complex', 'building manager', 'hoa',
            'association', 'maintenance request'
        ],
        phrases: [
            'calling on behalf of', 'tenant reported', 'property at',
            'multiple units', 'common area', 'building maintenance'
        ]
    },
    
    // Inspectors
    INSPECTOR: {
        keywords: [
            'inspector', 'inspection', 'code', 'permit', 'city', 'county',
            'building department', 'mechanical inspection', 'final inspection'
        ],
        phrases: [
            'schedule an inspection', 'inspection for', 'permit number',
            'ready for inspection', 'failed inspection', 'passed inspection'
        ]
    }
};

const COMMERCIAL_PATTERNS = {
    keywords: [
        'business', 'office', 'building', 'commercial', 'restaurant', 'store',
        'warehouse', 'facility', 'company', 'corporation', 'llc', 'inc',
        'plaza', 'center', 'suite', 'floor', 'medical', 'dental', 'clinic',
        'church', 'school', 'hotel', 'motel'
    ],
    phrases: [
        'our business', 'our office', 'the building', 'our facility',
        'company name is', 'we are a', 'multiple units', 'for the business',
        'commercial account', 'business account'
    ]
};

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

/**
 * Classify a caller based on all available information
 * 
 * @param {Object} params
 * @param {ObjectId} params.companyId - Company ID
 * @param {string} params.phone - Caller phone number
 * @param {string} params.userText - What the caller said
 * @param {Object} params.existingClassification - Previous classification (if updating)
 * @param {Object} params.customerLookupResult - Result from CustomerLookup (if already done)
 * @returns {Object} Classification result
 */
async function classifyCaller({
    companyId,
    phone,
    userText = '',
    existingClassification = null,
    customerLookupResult = null
}) {
    const startTime = Date.now();
    
    try {
        let classification = existingClassification || {
            type: CALLER_TYPES.UNKNOWN,
            subType: null,
            confidence: 0,
            source: 'none',
            vendorId: null,
            vendorName: null,
            customerId: null,
            customerName: null,
            isReturning: false,
            detectedInfo: {}
        };
        
        // STEP 1: Check if we already know this caller from phone lookup
        if (customerLookupResult?.customer) {
            classification = {
                ...classification,
                type: CALLER_TYPES.CUSTOMER,
                subType: customerLookupResult.customer.subType || CALLER_SUB_TYPES.RESIDENTIAL,
                confidence: 0.95,
                source: 'phone_lookup',
                customerId: customerLookupResult.customer._id,
                customerName: customerLookupResult.customer.name?.first || 
                              customerLookupResult.customer.name?.full || 
                              'Known Customer',
                isReturning: customerLookupResult.isReturning || false
            };
            
            // Check if commercial
            if (isCommercialFromCustomer(customerLookupResult.customer)) {
                classification.subType = CALLER_SUB_TYPES.COMMERCIAL;
            }
            
            logger.debug('[CALLER CLASSIFICATION] Identified from customer lookup', {
                type: classification.type,
                subType: classification.subType,
                name: classification.customerName
            });
            
            return classification;
        }
        
        // STEP 2: Check if this is a known vendor by phone
        if (phone) {
            const vendor = await Vendor.findByPhone(companyId, phone);
            if (vendor) {
                classification = {
                    ...classification,
                    type: CALLER_TYPES.VENDOR,
                    subType: vendor.type || CALLER_SUB_TYPES.OTHER,
                    confidence: 0.95,
                    source: 'phone_lookup',
                    vendorId: vendor._id,
                    vendorName: vendor.name
                };
                
                logger.debug('[CALLER CLASSIFICATION] Identified as known vendor', {
                    vendorName: vendor.name,
                    vendorType: vendor.type
                });
                
                return classification;
            }
        }
        
        // STEP 3: Analyze caller's text for patterns
        if (userText && userText.length > 5) {
            const textAnalysis = analyzeCallerText(userText);
            
            if (textAnalysis.isVendor) {
                // Try to match to a known vendor by name
                const vendorMatch = await matchVendorByText(companyId, userText);
                
                classification = {
                    ...classification,
                    type: CALLER_TYPES.VENDOR,
                    subType: textAnalysis.vendorType || CALLER_SUB_TYPES.OTHER,
                    confidence: textAnalysis.confidence,
                    source: 'text_analysis',
                    vendorId: vendorMatch?.vendor?._id || null,
                    vendorName: vendorMatch?.vendor?.name || textAnalysis.vendorName || null,
                    detectedInfo: textAnalysis.extractedInfo
                };
                
                logger.info('[CALLER CLASSIFICATION] 🏪 Detected as VENDOR', {
                    subType: classification.subType,
                    vendorName: classification.vendorName,
                    confidence: classification.confidence,
                    extractedInfo: textAnalysis.extractedInfo
                });
                
            } else if (textAnalysis.isCommercial) {
                classification = {
                    ...classification,
                    type: CALLER_TYPES.CUSTOMER,
                    subType: CALLER_SUB_TYPES.COMMERCIAL,
                    confidence: textAnalysis.confidence,
                    source: 'text_analysis'
                };
                
                logger.debug('[CALLER CLASSIFICATION] 🏢 Detected as COMMERCIAL customer');
                
            } else {
                // Default to residential customer
                classification = {
                    ...classification,
                    type: CALLER_TYPES.CUSTOMER,
                    subType: CALLER_SUB_TYPES.RESIDENTIAL,
                    confidence: 0.6,
                    source: 'default'
                };
            }
        }
        
        classification.latencyMs = Date.now() - startTime;
        
        return classification;
        
    } catch (error) {
        logger.error('[CALLER CLASSIFICATION] Error (non-fatal)', { error: error.message });
        return {
            type: CALLER_TYPES.UNKNOWN,
            subType: null,
            confidence: 0,
            source: 'error',
            error: error.message
        };
    }
}

// ============================================================================
// TEXT ANALYSIS
// ============================================================================

/**
 * Analyze caller text for classification patterns
 */
function analyzeCallerText(text) {
    const normalized = text.toLowerCase();
    const result = {
        isVendor: false,
        vendorType: null,
        vendorName: null,
        isCommercial: false,
        confidence: 0,
        extractedInfo: {}
    };
    
    // Check vendor patterns
    for (const [vendorType, patterns] of Object.entries(VENDOR_PATTERNS)) {
        let score = 0;
        
        // Check keywords
        for (const keyword of patterns.keywords) {
            if (normalized.includes(keyword.toLowerCase())) {
                score += 1;
            }
        }
        
        // Check phrases (weighted higher)
        for (const phrase of patterns.phrases) {
            if (normalized.includes(phrase.toLowerCase())) {
                score += 2;
            }
        }
        
        if (score >= 2) {
            result.isVendor = true;
            result.vendorType = vendorType.toLowerCase();
            result.confidence = Math.min(0.95, 0.5 + (score * 0.1));
            
            // Try to extract vendor name
            result.vendorName = extractVendorName(text);
            
            // Extract vendor-specific info
            if (vendorType === 'SUPPLY_HOUSE') {
                result.extractedInfo.poNumber = extractPONumber(text);
                result.extractedInfo.partDescription = extractPartDescription(text);
                result.extractedInfo.customerName = extractCustomerNameMention(text);
            } else if (vendorType === 'DELIVERY') {
                result.extractedInfo.trackingNumber = extractTrackingNumber(text);
            } else if (vendorType === 'WARRANTY') {
                result.extractedInfo.claimNumber = extractClaimNumber(text);
            }
            
            break;
        }
    }
    
    // If not vendor, check for commercial
    if (!result.isVendor) {
        let commercialScore = 0;
        
        for (const keyword of COMMERCIAL_PATTERNS.keywords) {
            if (normalized.includes(keyword.toLowerCase())) {
                commercialScore += 1;
            }
        }
        
        for (const phrase of COMMERCIAL_PATTERNS.phrases) {
            if (normalized.includes(phrase.toLowerCase())) {
                commercialScore += 2;
            }
        }
        
        if (commercialScore >= 2) {
            result.isCommercial = true;
            result.confidence = Math.min(0.9, 0.5 + (commercialScore * 0.1));
        }
    }
    
    return result;
}

/**
 * Try to match caller to a known vendor by name mention
 */
async function matchVendorByText(companyId, text) {
    try {
        const vendors = await Vendor.getCommonVendors(companyId);
        
        for (const vendor of vendors) {
            if (vendor.matchesText?.(text)) {
                return { vendor, matched: true };
            }
            
            // Check if vendor name is in text
            if (text.toLowerCase().includes(vendor.name.toLowerCase())) {
                return { vendor, matched: true };
            }
            
            // Check aliases
            for (const alias of vendor.aliases || []) {
                if (text.toLowerCase().includes(alias)) {
                    return { vendor, matched: true };
                }
            }
        }
        
        return null;
        
    } catch (error) {
        logger.warn('[CALLER CLASSIFICATION] Vendor match failed', { error: error.message });
        return null;
    }
}

// ============================================================================
// EXTRACTION HELPERS
// ============================================================================

function extractVendorName(text) {
    // Common vendor name patterns
    const patterns = [
        /(?:this is|calling from|it's)\s+([A-Z][A-Za-z\s]+?)(?:\s+calling|\s+here|,|\.)/i,
        /^([A-Z][A-Za-z\s]+?)(?:\s+calling|\s+here|,)/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const name = match[1].trim();
            if (name.length >= 3 && name.length <= 50) {
                return name;
            }
        }
    }
    
    return null;
}

function extractPONumber(text) {
    const patterns = [
        /(?:po|purchase order|p\.o\.)\s*#?\s*(\d+)/i,
        /(?:order|number)\s*#?\s*(\d{4,})/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    
    return null;
}

function extractPartDescription(text) {
    const patterns = [
        /(?:the|your)\s+(\w+(?:\s+\w+)?)\s+(?:is|are)\s+(?:ready|in|here)/i,
        /(?:motor|compressor|capacitor|coil|thermostat|unit|equipment|part)/i
    ];
    
    const match = text.match(patterns[0]);
    if (match) return match[1];
    
    // Look for common part names
    const partMatch = text.match(patterns[1]);
    if (partMatch) return partMatch[0];
    
    return null;
}

function extractCustomerNameMention(text) {
    const patterns = [
        /(?:for|customer)\s+(?:name\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
        /(?:johnson|smith|jones|williams|brown|davis|miller|wilson|moore|taylor|anderson|thomas|jackson|white|harris|martin|thompson|garcia|martinez|robinson|clark|rodriguez|lewis|lee|walker|hall|allen|young|hernandez|king|wright|lopez|hill|scott|green|adams|baker|gonzalez|nelson|carter|mitchell|perez|roberts|turner|phillips|campbell|parker|evans|edwards|collins|stewart|sanchez|morris|rogers|reed|cook|morgan|bell|murphy|bailey|rivera|cooper|richardson|cox|howard|ward|torres|peterson|gray|ramirez|james|watson|brooks|kelly|sanders|price|bennett|wood|barnes|ross|henderson|coleman|jenkins|perry|powell|long|patterson|hughes|flores|washington|butler|simmons|foster|gonzales)/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const name = match[1] || match[0];
            // Don't return if it matches common words
            if (!['the', 'for', 'customer'].includes(name.toLowerCase())) {
                return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            }
        }
    }
    
    return null;
}

function extractTrackingNumber(text) {
    const patterns = [
        /(?:tracking|confirmation)\s*#?\s*:?\s*(\w{10,30})/i,
        /1Z[A-Z0-9]{16}/i,  // UPS
        /\d{12,22}/         // Generic long number
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1] || match[0];
    }
    
    return null;
}

function extractClaimNumber(text) {
    const patterns = [
        /(?:claim|authorization|auth)\s*#?\s*:?\s*(\w{5,20})/i,
        /(?:work order|wo)\s*#?\s*:?\s*(\d{5,})/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    
    return null;
}

function isCommercialFromCustomer(customer) {
    // Check tags
    if (customer.tags?.some(t => 
        ['commercial', 'business', 'company'].includes(t.toLowerCase())
    )) {
        return true;
    }
    
    // Check address for commercial indicators
    const address = customer.addresses?.[0];
    if (address) {
        const addressStr = `${address.street || ''} ${address.notes || ''}`.toLowerCase();
        if (COMMERCIAL_PATTERNS.keywords.some(k => addressStr.includes(k))) {
            return true;
        }
    }
    
    return false;
}

// ============================================================================
// CARD DATA BUILDER
// ============================================================================

/**
 * Build card data from classification and call info
 * 
 * @param {Object} classification - From classifyCaller()
 * @param {Object} callData - Call summary data
 * @returns {Object} Card data for CallSummary
 */
function buildCardData(classification, callData) {
    const cardData = {
        headline: '',
        brief: '',
        priority: 'normal',
        status: 'needs_action',
        tags: [],
        color: 'green'
    };
    
    // Build headline
    if (classification.type === CALLER_TYPES.VENDOR) {
        cardData.headline = classification.vendorName || 'Vendor Call';
        cardData.color = classification.subType === 'delivery' ? 'orange' : 'yellow';
        cardData.vendorType = classification.subType;
        
        // Add extracted info
        if (classification.detectedInfo?.poNumber) {
            cardData.reference = `PO# ${classification.detectedInfo.poNumber}`;
            cardData.tags.push('parts-ready');
        }
        if (classification.detectedInfo?.customerName) {
            cardData.linkedCustomerName = classification.detectedInfo.customerName;
            cardData.brief = `For ${classification.detectedInfo.customerName}`;
        }
        if (classification.detectedInfo?.partDescription) {
            cardData.partDescription = classification.detectedInfo.partDescription;
            if (cardData.brief) {
                cardData.brief += ` - ${classification.detectedInfo.partDescription}`;
            } else {
                cardData.brief = classification.detectedInfo.partDescription;
            }
        }
        
    } else if (classification.type === CALLER_TYPES.CUSTOMER) {
        cardData.headline = classification.customerName || callData.callerName || 'Customer';
        
        if (classification.subType === CALLER_SUB_TYPES.COMMERCIAL) {
            cardData.color = 'blue';
            cardData.tags.push('commercial');
        }
        
        if (classification.isReturning) {
            cardData.tags.push('returning');
        }
        
        // Brief from call data
        if (callData.summary) {
            cardData.brief = callData.summary;
        } else if (callData.intent) {
            cardData.brief = callData.intent;
        }
        
    } else {
        cardData.headline = 'Unknown Caller';
        cardData.color = 'gray';
        cardData.tags.push('needs-review');
    }
    
    // Add urgency tag if needed
    if (callData.urgency === 'emergency' || callData.urgency === 'urgent') {
        cardData.priority = callData.urgency === 'emergency' ? 'urgent' : 'high';
        cardData.tags.push(callData.urgency);
        if (classification.type === CALLER_TYPES.CUSTOMER) {
            cardData.color = 'red';
        }
    }
    
    // Set status based on outcome
    if (callData.outcome === 'booked' || callData.outcome === 'scheduled') {
        cardData.status = 'scheduled';
    } else if (callData.outcome === 'completed') {
        cardData.status = 'completed';
    } else if (callData.outcome === 'callback_requested') {
        cardData.tags.push('callback');
        cardData.priority = 'high';
    }
    
    return cardData;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    classifyCaller,
    buildCardData,
    analyzeCallerText,
    CALLER_TYPES,
    CALLER_SUB_TYPES,
    VENDOR_PATTERNS,
    COMMERCIAL_PATTERNS
};
