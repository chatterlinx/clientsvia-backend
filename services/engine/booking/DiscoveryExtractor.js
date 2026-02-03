/**
 * ════════════════════════════════════════════════════════════════════════════════
 * DISCOVERY EXTRACTOR - V92 (Feb 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Deterministic extraction of call context from caller's utterance.
 * This runs BEFORE generating a response so the agent can acknowledge what was said.
 * 
 * EXTRACTS:
 * - Issue/symptom (what's broken)
 * - Urgency signals (emergency, ASAP, temperature)
 * - Tech mention (previous technician name)
 * - Tenure phrase (longtime customer, you installed)
 * - Equipment mention (AC system, furnace, etc.)
 * 
 * WHY THIS MATTERS:
 * Without this, caller says "My AC is not cooling, it's 80 degrees, Peter came 
 * out last week" and the system responds "Would you like to schedule?" - amnesia.
 * 
 * WITH THIS:
 * Agent acknowledges: "I'm sorry to hear the AC isn't cooling and it's 80° - 
 * you mentioned Peter was out last week. Let's get someone back out to you."
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// HVAC SYMPTOMS
// ════════════════════════════════════════════════════════════════════════════════
const HVAC_SYMPTOM_PATTERNS = [
    // Cooling issues
    { pattern: /\b(not\s+cooling|isn't\s+cooling|won't\s+cool|doesn't\s+cool|stopped\s+cooling)\b/i, symptom: 'not cooling', urgency: 'high' },
    { pattern: /\bno\s+(air|ac|cooling|cold\s+air)\b/i, symptom: 'no cooling', urgency: 'high' },
    { pattern: /\b(ac|air\s+conditioning?)\s+(broken|broke|stopped|not\s+working|won't\s+work)\b/i, symptom: 'AC not working', urgency: 'high' },
    { pattern: /\b(blowing|blows)\s+(hot|warm)\s+(air)?\b/i, symptom: 'blowing warm air', urgency: 'high' },
    
    // Heating issues
    { pattern: /\b(not\s+heating|isn't\s+heating|won't\s+heat|doesn't\s+heat|stopped\s+heating)\b/i, symptom: 'not heating', urgency: 'high' },
    { pattern: /\bno\s+(heat|heating)\b/i, symptom: 'no heat', urgency: 'emergency' },
    { pattern: /\b(heater|furnace|heat\s+pump)\s+(broken|broke|stopped|not\s+working|won't\s+work)\b/i, symptom: 'heater not working', urgency: 'high' },
    
    // Noise issues
    { pattern: /\b(making|makes)\s+(noise|sound|loud|strange|weird)\b/i, symptom: 'making noise', urgency: 'medium' },
    { pattern: /\b(loud|strange|weird)\s+(noise|sound)\b/i, symptom: 'strange noise', urgency: 'medium' },
    { pattern: /\b(clicking|banging|grinding|squealing|humming|buzzing)\b/i, symptom: 'unusual noise', urgency: 'medium' },
    
    // Leak issues
    { pattern: /\b(leaking|leak|water)\s+(from|around|under)\b/i, symptom: 'leaking', urgency: 'high' },
    { pattern: /\bwater\s+(damage|dripping|pooling)\b/i, symptom: 'water leak', urgency: 'high' },
    
    // General issues
    { pattern: /\b(won't\s+turn\s+on|doesn't\s+turn\s+on|not\s+turning\s+on)\b/i, symptom: 'won\'t turn on', urgency: 'high' },
    { pattern: /\b(running\s+constantly|runs?\s+all\s+the\s+time|never\s+stops)\b/i, symptom: 'running constantly', urgency: 'medium' },
    { pattern: /\b(short\s+cycling|turns?\s+on\s+and\s+off)\b/i, symptom: 'short cycling', urgency: 'medium' },
    { pattern: /\b(frozen|freezing|ice)\b/i, symptom: 'frozen unit', urgency: 'high' }
];

// ════════════════════════════════════════════════════════════════════════════════
// TEMPERATURE PATTERNS (indicates urgency)
// ════════════════════════════════════════════════════════════════════════════════
const TEMPERATURE_PATTERN = /(\d{2,3})\s*°?\s*(degrees?|f|fahrenheit)?/i;

// ════════════════════════════════════════════════════════════════════════════════
// TECHNICIAN NAME PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
const TECH_NAME_PATTERNS = [
    /(?:his|her|the|your)\s+(?:name\s+(?:was|is)|guy|tech|technician)\s+(?:was\s+)?(\w+)/i,
    /(\w+)\s+(?:was|came|came\s+out|was\s+out|was\s+here)/i,
    /(?:guy|tech|technician)\s+(?:named?|called)\s+(\w+)/i,
    /(?:same|prefer|want|like)\s+(\w+)/i,
    /(?:send|have)\s+(\w+)\s+(?:back|out|again)/i
];

// Common names to match (can be augmented with company tech roster)
const COMMON_TECH_NAMES = new Set([
    'peter', 'dustin', 'marcello', 'mike', 'michael', 'john', 'david', 'james', 
    'robert', 'chris', 'daniel', 'kevin', 'brian', 'jose', 'carlos', 'steve',
    'tony', 'tom', 'jason', 'jeff', 'eric', 'mark', 'ryan', 'matt', 'matthew',
    'nick', 'nicholas', 'andrew', 'joe', 'joseph', 'tim', 'timothy', 'gary',
    'larry', 'terry', 'jerry', 'billy', 'bob', 'bobby', 'rick', 'ricky', 'ray'
]);

// ════════════════════════════════════════════════════════════════════════════════
// TENURE/RELATIONSHIP PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
const TENURE_PATTERNS = [
    { pattern: /\b(longtime|long\s*time|long-time)\s+(customer|client)\b/i, tenure: 'longtime_customer' },
    { pattern: /\b(regular|repeat|returning)\s+(customer|client)\b/i, tenure: 'returning_customer' },
    { pattern: /\byou\s+(guys\s+)?(installed|put\s+in|set\s+up)\b/i, tenure: 'installed_by_company' },
    { pattern: /\b(you've\s+been|been\s+using\s+you|using\s+you)\s+(for|since)\b/i, tenure: 'longtime_customer' },
    { pattern: /\b(years?|months?)\s+(with\s+you|customer)\b/i, tenure: 'longtime_customer' },
    { pattern: /\b(came|was)\s+(out|here)\s+(last|a)\s+(week|month|year)/i, tenure: 'recent_visit' },
    { pattern: /\b(just|recently)\s+(came|was)\s+(out|here)\b/i, tenure: 'recent_visit' },
    { pattern: /\b(about|like)\s+a\s+week\b/i, tenure: 'recent_visit' }
];

// ════════════════════════════════════════════════════════════════════════════════
// EQUIPMENT PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
const EQUIPMENT_PATTERNS = [
    { pattern: /\b(ac|air\s+conditioning?|air\s+conditioner)\s*(system|unit)?\b/i, equipment: 'AC system' },
    { pattern: /\b(heater|furnace|heat\s+pump)\s*(system|unit)?\b/i, equipment: 'heating system' },
    { pattern: /\bhvac\s*(system|unit)?\b/i, equipment: 'HVAC system' },
    { pattern: /\bthermostat\b/i, equipment: 'thermostat' },
    { pattern: /\b(outside|outdoor|condenser)\s*(unit)?\b/i, equipment: 'outdoor unit' },
    { pattern: /\b(inside|indoor|air\s+handler)\s*(unit)?\b/i, equipment: 'indoor unit' },
    { pattern: /\bductwork|ducts?\b/i, equipment: 'ductwork' },
    { pattern: /\bvents?\b/i, equipment: 'vents' }
];

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTOR CLASS
// ════════════════════════════════════════════════════════════════════════════════
class DiscoveryExtractor {
    
    /**
     * Extract all discovery facts from an utterance
     * 
     * @param {string} utterance - User's speech input
     * @param {Object} context - Additional context
     * @param {string[]} context.techRoster - Company's technician names (optional)
     * @param {string} context.trade - Company's trade (hvac, plumbing, etc.)
     * @returns {Object} Extracted discovery facts
     */
    static extract(utterance, context = {}) {
        if (!utterance || typeof utterance !== 'string') {
            return { hasDiscovery: false };
        }
        
        const text = utterance.trim().toLowerCase();
        const result = {
            hasDiscovery: false,
            symptoms: [],
            issue: null,
            urgency: 'normal',
            temperature: null,
            techMentioned: null,
            tenure: null,
            equipment: [],
            recentVisit: false,
            raw: {}
        };
        
        // Extract symptoms
        for (const { pattern, symptom, urgency } of HVAC_SYMPTOM_PATTERNS) {
            if (pattern.test(text)) {
                result.symptoms.push(symptom);
                if (!result.issue) result.issue = symptom;
                if (urgency === 'emergency' || (urgency === 'high' && result.urgency !== 'emergency')) {
                    result.urgency = urgency;
                } else if (urgency === 'medium' && result.urgency === 'normal') {
                    result.urgency = urgency;
                }
                result.hasDiscovery = true;
            }
        }
        
        // Extract temperature mention
        const tempMatch = utterance.match(TEMPERATURE_PATTERN);
        if (tempMatch) {
            const temp = parseInt(tempMatch[1], 10);
            if (temp >= 50 && temp <= 120) {
                result.temperature = temp;
                result.raw.temperatureRaw = tempMatch[0];
                // High temp = high urgency
                if (temp >= 80) result.urgency = 'high';
                if (temp >= 90) result.urgency = 'emergency';
                result.hasDiscovery = true;
            }
        }
        
        // Extract tech name mentioned
        const techRoster = context.techRoster || [];
        const allTechNames = new Set([
            ...COMMON_TECH_NAMES,
            ...techRoster.map(n => n.toLowerCase())
        ]);
        
        for (const pattern of TECH_NAME_PATTERNS) {
            const match = utterance.match(pattern);
            if (match && match[1]) {
                const potentialName = match[1].toLowerCase();
                // Verify it looks like a name (not a common word)
                if (allTechNames.has(potentialName) || 
                    (potentialName.length >= 3 && /^[a-z]+$/i.test(potentialName))) {
                    result.techMentioned = this.titleCase(match[1]);
                    result.hasDiscovery = true;
                    break;
                }
            }
        }
        
        // Extract tenure/relationship
        for (const { pattern, tenure } of TENURE_PATTERNS) {
            if (pattern.test(text)) {
                result.tenure = tenure;
                if (tenure === 'recent_visit') {
                    result.recentVisit = true;
                }
                result.hasDiscovery = true;
                break;
            }
        }
        
        // Extract equipment mentions
        for (const { pattern, equipment } of EQUIPMENT_PATTERNS) {
            if (pattern.test(text)) {
                if (!result.equipment.includes(equipment)) {
                    result.equipment.push(equipment);
                }
                result.hasDiscovery = true;
            }
        }
        
        // Set primary issue if not already set
        if (!result.issue && result.symptoms.length > 0) {
            result.issue = result.symptoms[0];
        }
        
        logger.debug('[DISCOVERY EXTRACTOR] Extraction complete', {
            hasDiscovery: result.hasDiscovery,
            issue: result.issue,
            urgency: result.urgency,
            techMentioned: result.techMentioned,
            tenure: result.tenure,
            symptomCount: result.symptoms.length,
            equipmentCount: result.equipment.length,
            temperature: result.temperature
        });
        
        return result;
    }
    
    /**
     * Build acknowledgment text from extracted facts
     * 
     * @param {Object} discovery - Result from extract()
     * @param {Object} slots - Collected slots (name, etc.)
     * @returns {string} Acknowledgment phrase
     */
    static buildAcknowledgment(discovery, slots = {}) {
        const parts = [];
        
        // Name acknowledgment
        const name = slots.name?.value || slots.name;
        if (name && typeof name === 'string') {
            parts.push(`Got it, ${name}`);
        }
        
        // Issue acknowledgment
        if (discovery.issue) {
            if (parts.length > 0) {
                parts[parts.length - 1] += ' —';
            }
            
            // Temperature makes it more empathetic
            if (discovery.temperature && discovery.temperature >= 80) {
                parts.push(`${discovery.issue} and it's ${discovery.temperature}° in the house`);
            } else {
                parts.push(discovery.issue);
            }
        }
        
        // Tech mention acknowledgment
        if (discovery.techMentioned) {
            if (discovery.recentVisit) {
                parts.push(`You mentioned ${discovery.techMentioned} was out recently`);
            } else {
                parts.push(`You mentioned ${discovery.techMentioned}`);
            }
        } else if (discovery.recentVisit) {
            parts.push(`I see someone was out recently`);
        }
        
        // Tenure acknowledgment
        if (discovery.tenure === 'longtime_customer') {
            parts.push(`I appreciate you being a longtime customer`);
        } else if (discovery.tenure === 'installed_by_company') {
            parts.push(`I see we installed your system`);
        }
        
        // Join intelligently
        if (parts.length === 0) return null;
        
        let acknowledgment = parts[0];
        for (let i = 1; i < parts.length; i++) {
            // Check if previous part ends with punctuation
            if (/[.!?—]$/.test(acknowledgment)) {
                acknowledgment += ' ' + this.capitalizeFirst(parts[i]);
            } else {
                acknowledgment += '. ' + this.capitalizeFirst(parts[i]);
            }
        }
        
        // End with transition
        if (!acknowledgment.endsWith('.') && !acknowledgment.endsWith('!')) {
            acknowledgment += '.';
        }
        acknowledgment += ' Let me get you taken care of.';
        
        return acknowledgment;
    }
    
    /**
     * Helper: Title case a name
     */
    static titleCase(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
    
    /**
     * Helper: Capitalize first letter
     */
    static capitalizeFirst(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = DiscoveryExtractor;
module.exports.HVAC_SYMPTOM_PATTERNS = HVAC_SYMPTOM_PATTERNS;
module.exports.TECH_NAME_PATTERNS = TECH_NAME_PATTERNS;
module.exports.TENURE_PATTERNS = TENURE_PATTERNS;
