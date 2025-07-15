
/**
 * HVAC Tenant Configuration - Extracted from current agent
 */
class HVACTenantConfig {
  constructor() {
    this.industryType = 'hvac';
    this.config = {
      // Migrated from current aiAgent.js logic
      intents: {
        'thermostat_issue': {
          keywords: ['blank thermostat', 'thermostat not working', 'display blank'],
          priority: 'high',
          compliance: ['basic_electrical_safety'],
          response_template: 'hvac_thermostat_troubleshooting'
        },
        'cooling_problem': {
          keywords: ['not cooling', 'warm air', 'ac not working'],
          priority: 'high', 
          compliance: ['refrigerant_handling'],
          response_template: 'hvac_cooling_diagnosis'
        },
        'pricing_service_call': {
          keywords: ['service call cost', 'how much service call', 'diagnostic fee'],
          priority: 'medium',
          compliance: ['transparent_pricing'],
          response_template: 'hvac_service_call_pricing'
        }
      },

      // Migrated from enhanced-intent-classification.js
      entities: {
        'hvac_brands': ['Carrier', 'Trane', 'Lennox', 'Goodman', 'Rheem'],
        'refrigerant_types': ['R-410A', 'R-22', 'R-32'],
        'system_types': ['Central AC', 'Heat Pump', 'Package Unit']
      },

      // New compliance framework
      compliance: {
        'epa_regulations': {
          required: true,
          triggers: ['refrigerant', 'leak', 'recharge'],
          message: 'All refrigerant work performed by EPA-certified technicians'
        },
        'transparent_pricing': {
          required: true,
          triggers: ['cost', 'price', 'charge'],
          message: 'Upfront pricing provided before any work begins'
        }
      },

      // Migrated from current pricing structure  
      pricing: {
        'service_call': { amount: 49, description: 'Diagnostic visit and inspection' },
        'maintenance': { amount: 89, description: 'Comprehensive tune-up service' },
        'repair_range': { min: 150, max: 800, description: 'Varies by issue and parts' }
      }
    };
  }
}