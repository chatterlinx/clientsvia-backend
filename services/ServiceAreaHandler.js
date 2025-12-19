/**
 * ============================================================================
 * SERVICE AREA HANDLER
 * ============================================================================
 * 
 * Detects and responds to service area questions.
 * Makes callers feel confident we can help them.
 * 
 * When caller asks "Do you service Fort Myers?", we should immediately 
 * confirm instead of giving generic robot responses.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// ============================================================================
// DEFAULT SERVICE AREAS (Per-company overrides in Company.serviceAreas)
// ============================================================================

const DEFAULT_SERVICE_AREAS = {
    // Southwest Florida (HVAC territory)
    cities: [
        'fort myers', 'naples', 'cape coral', 'bonita springs', 'estero',
        'marco island', 'lehigh acres', 'punta gorda', 'port charlotte',
        'sanibel', 'captiva', 'north fort myers', 'south fort myers',
        'golden gate', 'immokalee', 'ave maria', 'labelle'
    ],
    counties: ['lee county', 'collier county', 'charlotte county'],
    regions: ['southwest florida', 'swfl', 'sw florida']
};

// ============================================================================
// RESPONSE TEMPLATES (Admin-editable via frontDeskBehavior)
// ============================================================================

const DEFAULT_RESPONSES = {
    // When we DO service their area
    serviceAreaConfirm: "Yes, we absolutely service {city} and all of Southwest Florida! We've been taking care of customers there for years.",
    
    // When area is unclear
    serviceAreaAsk: "We service most of Southwest Florida. What city or area are you located in?",
    
    // When we DON'T service their area (rare)
    serviceAreaDecline: "I'm sorry, we don't currently service that area. Would you like me to suggest a company that might help?"
};

// ============================================================================
// MAIN SERVICE
// ============================================================================

class ServiceAreaHandler {
    
    /**
     * Check if user input contains a service area question
     */
    static isServiceAreaQuestion(userInput) {
        if (!userInput) return false;
        const lower = userInput.toLowerCase();
        
        // Patterns that indicate service area questions
        const patterns = [
            /do you (service|cover|work in|come to|go to)/i,
            /service (my area|this area|here)/i,
            /come out to/i,
            /serve (my|this)/i,
            /in (my|this) area/i,
            /available in/i,
            /work in .*(\?|$)/i
        ];
        
        return patterns.some(p => p.test(lower));
    }
    
    /**
     * Detect city/area from user input
     * Returns { city, isKnownArea, matchType }
     */
    static detectArea(userInput, companyServiceAreas = null) {
        if (!userInput) return null;
        const lower = userInput.toLowerCase();
        
        // Merge company-specific areas with defaults
        const areas = {
            cities: [...DEFAULT_SERVICE_AREAS.cities],
            counties: [...DEFAULT_SERVICE_AREAS.counties],
            regions: [...DEFAULT_SERVICE_AREAS.regions]
        };
        
        if (companyServiceAreas) {
            if (Array.isArray(companyServiceAreas.cities)) {
                areas.cities.push(...companyServiceAreas.cities.map(c => c.toLowerCase()));
            }
            if (Array.isArray(companyServiceAreas.counties)) {
                areas.counties.push(...companyServiceAreas.counties.map(c => c.toLowerCase()));
            }
            if (Array.isArray(companyServiceAreas.regions)) {
                areas.regions.push(...companyServiceAreas.regions.map(c => c.toLowerCase()));
            }
        }
        
        // Check cities first (most specific)
        for (const city of areas.cities) {
            if (lower.includes(city)) {
                return {
                    city: this.capitalize(city),
                    isKnownArea: true,
                    matchType: 'city'
                };
            }
        }
        
        // Check counties
        for (const county of areas.counties) {
            if (lower.includes(county)) {
                return {
                    city: this.capitalize(county),
                    isKnownArea: true,
                    matchType: 'county'
                };
            }
        }
        
        // Check regions
        for (const region of areas.regions) {
            if (lower.includes(region)) {
                return {
                    city: this.capitalize(region),
                    isKnownArea: true,
                    matchType: 'region'
                };
            }
        }
        
        // Try to extract any city-like mention with Florida
        const floridaCityMatch = lower.match(/([a-z\s]+),?\s*florida/i);
        if (floridaCityMatch) {
            const possibleCity = floridaCityMatch[1].trim();
            if (possibleCity.length > 2 && possibleCity.length < 30) {
                return {
                    city: this.capitalize(possibleCity),
                    isKnownArea: false, // Unknown - might not be in our area
                    matchType: 'extracted'
                };
            }
        }
        
        return null;
    }
    
    /**
     * Generate service area response
     */
    static generateResponse(userInput, companyServiceAreas = null, responseTemplates = null) {
        const templates = responseTemplates || DEFAULT_RESPONSES;
        const detected = this.detectArea(userInput, companyServiceAreas);
        
        if (!detected) {
            // Area not detected - ask for clarification
            return {
                response: templates.serviceAreaAsk,
                detected: null,
                action: 'ask_area'
            };
        }
        
        if (detected.isKnownArea) {
            // We service this area - confirm!
            const response = templates.serviceAreaConfirm.replace('{city}', detected.city);
            return {
                response,
                detected,
                action: 'confirm_area'
            };
        }
        
        // Unknown area - be cautious but positive
        // V36: Don't hardcode booking prompts - just acknowledge and let booking engine ask
        return {
            response: `I believe we service ${detected.city} - let me confirm that while I get your information.`,
            detected,
            action: 'confirm_with_booking'
        };
    }
    
    /**
     * Capitalize city names properly
     */
    static capitalize(str) {
        return str.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    
    /**
     * Detect service needs from input (duct cleaning, thermostat, etc.)
     */
    static detectServiceNeeds(userInput) {
        if (!userInput) return [];
        const lower = userInput.toLowerCase();
        
        const services = [];
        
        // Duct-related
        if (/duct|air duct|ductwork|vent cleaning/i.test(lower)) {
            services.push({ type: 'duct_cleaning', display: 'duct cleaning' });
        }
        
        // Thermostat
        if (/thermostat|thermo stat|temperature control/i.test(lower)) {
            services.push({ type: 'thermostat', display: 'thermostat service' });
        }
        
        // AC/Cooling
        if (/not cooling|won't cool|ac not working|air conditioning|a\/c|a c/i.test(lower)) {
            services.push({ type: 'ac_repair', display: 'AC repair' });
        }
        
        // Heating
        if (/not heating|heat not working|furnace|heater/i.test(lower)) {
            services.push({ type: 'heating_repair', display: 'heating repair' });
        }
        
        // Maintenance
        if (/tune.?up|maintenance|inspection|check/i.test(lower)) {
            services.push({ type: 'maintenance', display: 'maintenance' });
        }
        
        // Installation
        if (/install|installation|new unit|replacement/i.test(lower)) {
            services.push({ type: 'installation', display: 'installation' });
        }
        
        return services;
    }
    
    /**
     * Build a comprehensive response when caller mentions both area + services
     */
    static buildComprehensiveResponse(userInput, companyServiceAreas = null, responseTemplates = null) {
        const areaResult = this.generateResponse(userInput, companyServiceAreas, responseTemplates);
        const services = this.detectServiceNeeds(userInput);
        
        let response = areaResult.response;
        
        // If we detected services, acknowledge them
        if (services.length > 0) {
            const serviceList = services.map(s => s.display).join(' and ');
            
            if (areaResult.action === 'confirm_area') {
                // Area confirmed + services mentioned
                // V36: Don't hardcode booking prompts - booking engine will ask name
                response = `Yes, we absolutely service ${areaResult.detected?.city || 'your area'}! `;
                response += `It sounds like you need ${serviceList} — we can definitely help with that.`;
            } else if (areaResult.action === 'ask_area') {
                // Services mentioned but no area
                response = `Great, we can help with ${serviceList}! `;
                response += `We service most of Southwest Florida. What city are you located in?`;
            }
        }
        
        return {
            response,
            detected: areaResult.detected,
            services,
            action: services.length > 0 ? 'acknowledge_and_book' : areaResult.action
        };
    }
}

module.exports = ServiceAreaHandler;

