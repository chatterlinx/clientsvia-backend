/**
 * ============================================================================
 * SENSITIVE DATA MASKER
 * ============================================================================
 * 
 * Masks sensitive slot values for UI display and logging.
 * 
 * RULES:
 * - Raw values stay in Redis (runtime only, encrypted at rest)
 * - Masked values shown in Call Center UI / timeline / logs
 * - Masking is based on slot type and sensitive flag
 * 
 * MASKING PATTERNS:
 * - phone: (239) 555-1234 → (239) ***-1234
 * - email: john.doe@email.com → j***@email.com
 * - ssn: 123-45-6789 → ***-**-6789
 * - dob: 1985-06-15 → **/**/1985
 * - membershipNumber: ABC123456 → ABC***456
 * - creditCard: BLOCKED entirely
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

/**
 * Slot types that are ALWAYS sensitive (mask regardless of config)
 */
const ALWAYS_SENSITIVE_TYPES = new Set([
    'ssn',
    'social_security',
    'credit_card',
    'card_number',
    'cvv',
    'password',
    'pin'
]);

/**
 * Slot types that are sensitive by default (can be overridden)
 */
const DEFAULT_SENSITIVE_TYPES = new Set([
    'dob',
    'date_of_birth',
    'birthday',
    'membershipNumber',
    'membership_number',
    'account_number',
    'insurance_id',
    'policy_number',
    'license_number',
    'drivers_license'
]);

class SensitiveMasker {
    
    /**
     * ========================================================================
     * MASK SLOTS - Mask all sensitive slots for display
     * ========================================================================
     * 
     * @param {Object} slots - Slots object with values
     * @param {Object} slotConfig - Company's bookingSlots config (to check sensitive flag)
     * @returns {Object} Slots with masked values (original structure preserved)
     */
    static maskSlots(slots, slotConfig = []) {
        if (!slots || typeof slots !== 'object') return slots;
        
        const masked = {};
        const configMap = this.buildConfigMap(slotConfig);
        
        for (const [key, slot] of Object.entries(slots)) {
            const config = configMap[key] || {};
            const shouldMask = this.shouldMaskSlot(key, config);
            
            if (shouldMask && slot?.value) {
                masked[key] = {
                    ...slot,
                    value: this.maskValue(slot.value, key, config),
                    _masked: true
                };
            } else {
                masked[key] = slot;
            }
        }
        
        return masked;
    }
    
    /**
     * ========================================================================
     * MASK SINGLE VALUE
     * ========================================================================
     */
    static maskValue(value, slotKey, config = {}) {
        if (!value) return value;
        
        const strValue = String(value);
        const type = config.type || slotKey;
        
        // BLOCK entirely: credit cards, SSN
        if (ALWAYS_SENSITIVE_TYPES.has(type) || ALWAYS_SENSITIVE_TYPES.has(slotKey)) {
            if (type === 'credit_card' || type === 'card_number' || slotKey.includes('card')) {
                return '[REDACTED - CARD]';
            }
            if (type === 'ssn' || type === 'social_security') {
                // Show last 4 only
                const digits = strValue.replace(/\D/g, '');
                return `***-**-${digits.slice(-4) || '****'}`;
            }
        }
        
        // Mask by type
        switch (type) {
            case 'phone':
                return this.maskPhone(strValue);
            case 'email':
                return this.maskEmail(strValue);
            case 'dob':
            case 'date_of_birth':
            case 'birthday':
                return this.maskDate(strValue);
            case 'membershipNumber':
            case 'membership_number':
            case 'account_number':
            case 'insurance_id':
            case 'policy_number':
                return this.maskAccountNumber(strValue);
            case 'address':
                // Addresses are generally not masked (needed for service)
                return strValue;
            default:
                // Generic masking: show first 2 and last 2 chars
                return this.maskGeneric(strValue);
        }
    }
    
    /**
     * Mask phone: (239) 555-1234 → (239) ***-1234
     */
    static maskPhone(phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 10) {
            const last4 = digits.slice(-4);
            const areaCode = digits.slice(0, 3);
            return `(${areaCode}) ***-${last4}`;
        }
        return phone.slice(0, 3) + '***' + phone.slice(-2);
    }
    
    /**
     * Mask email: john.doe@email.com → j***@email.com
     */
    static maskEmail(email) {
        const parts = email.split('@');
        if (parts.length !== 2) return '***@***.***';
        
        const local = parts[0];
        const domain = parts[1];
        const maskedLocal = local.charAt(0) + '***';
        
        return `${maskedLocal}@${domain}`;
    }
    
    /**
     * Mask date: 1985-06-15 → **/**/1985
     */
    static maskDate(date) {
        // Try to extract year
        const yearMatch = date.match(/\d{4}/);
        if (yearMatch) {
            return `**/**/${yearMatch[0]}`;
        }
        return '**/**/****';
    }
    
    /**
     * Mask account/membership numbers: ABC123456 → ABC***456
     */
    static maskAccountNumber(number) {
        const str = String(number);
        if (str.length <= 4) return '****';
        
        // Show first 3 and last 3
        const prefix = str.slice(0, 3);
        const suffix = str.slice(-3);
        const middle = '*'.repeat(Math.max(3, str.length - 6));
        
        return `${prefix}${middle}${suffix}`;
    }
    
    /**
     * Generic masking for unknown types
     */
    static maskGeneric(value) {
        const str = String(value);
        if (str.length <= 4) return '****';
        
        const prefix = str.slice(0, 2);
        const suffix = str.slice(-2);
        const middle = '*'.repeat(Math.max(3, str.length - 4));
        
        return `${prefix}${middle}${suffix}`;
    }
    
    /**
     * ========================================================================
     * SHOULD MASK SLOT - Determine if slot should be masked
     * ========================================================================
     */
    static shouldMaskSlot(slotKey, config = {}) {
        // Always mask certain types
        if (ALWAYS_SENSITIVE_TYPES.has(slotKey) || ALWAYS_SENSITIVE_TYPES.has(config.type)) {
            return true;
        }
        
        // Check explicit sensitive flag from UI config
        if (config.sensitive === true) {
            return true;
        }
        
        // Don't mask if explicitly marked not sensitive
        if (config.sensitive === false) {
            return false;
        }
        
        // Default sensitive types
        if (DEFAULT_SENSITIVE_TYPES.has(slotKey) || DEFAULT_SENSITIVE_TYPES.has(config.type)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Build a map of slotKey → config for quick lookup
     */
    static buildConfigMap(slotConfig) {
        const map = {};
        if (!Array.isArray(slotConfig)) return map;
        
        for (const slot of slotConfig) {
            const key = slot.id || slot.slotId || slot.key;
            if (key) {
                map[key] = slot;
            }
        }
        return map;
    }
    
    /**
     * ========================================================================
     * MASK TIMELINE - Mask sensitive data in timeline events
     * ========================================================================
     */
    static maskTimeline(timeline, slotConfig = []) {
        if (!Array.isArray(timeline)) return timeline;
        
        return timeline.map(event => {
            const masked = { ...event };
            
            // Mask any slots in event data
            if (masked.data?.slots) {
                masked.data = {
                    ...masked.data,
                    slots: this.maskSlots(masked.data.slots, slotConfig)
                };
            }
            
            if (masked.data?.bookingCollected) {
                // bookingCollected is usually just values, convert to slot format
                const asSlots = {};
                for (const [k, v] of Object.entries(masked.data.bookingCollected)) {
                    asSlots[k] = { value: v };
                }
                const maskedSlots = this.maskSlots(asSlots, slotConfig);
                masked.data = {
                    ...masked.data,
                    bookingCollected: Object.fromEntries(
                        Object.entries(maskedSlots).map(([k, s]) => [k, s.value])
                    )
                };
            }
            
            return masked;
        });
    }
}

module.exports = SensitiveMasker;
module.exports.ALWAYS_SENSITIVE_TYPES = ALWAYS_SENSITIVE_TYPES;
module.exports.DEFAULT_SENSITIVE_TYPES = DEFAULT_SENSITIVE_TYPES;
