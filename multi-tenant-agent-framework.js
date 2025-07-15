/**
 * Multi-Tenant AI Agent Framework
 * Based on the comprehensive analysis of multi-tenant requirements
 * 
 * This demonstrates how to evolve from a single HVAC agent to a 
 * multi-tenant platform supporting different service industries
 */

// 1. TENANT CONFIGURATION SYSTEM
class TenantConfiguration {
  constructor(tenantId, industryType) {
    this.tenantId = tenantId;
    this.industryType = industryType; // 'hvac', 'plumbing', 'electrical', etc.
    this.config = this.loadTenantConfig();
  }

  loadTenantConfig() {
    const industryConfigs = {
      hvac: {
        // HVAC-specific intents and entities
        intents: {
          'diagnose_cooling_issue': {
            keywords: ['not cooling', 'warm air', 'ac not working', 'thermostat issue'],
            entities: ['thermostat_brand', 'refrigerant_type', 'seer_rating'],
            priority: 'high'
          },
          'schedule_maintenance': {
            keywords: ['tune up', 'maintenance', 'yearly service', 'filter change'],
            entities: ['system_type', 'last_service_date', 'warranty_status'],
            priority: 'medium'
          },
          'emergency_heating': {
            keywords: ['no heat', 'furnace not working', 'cold house'],
            entities: ['heating_type', 'emergency_level'],
            priority: 'urgent'
          }
        },
        
        // HVAC-specific entities
        entities: {
          'thermostat_brand': ['Nest', 'Honeywell', 'Ecobee', 'Carrier', 'Trane'],
          'refrigerant_type': ['R-410A', 'R-22', 'R-32', 'R-454B'],
          'system_type': ['Central AC', 'Heat Pump', 'Ductless Mini-Split', 'Package Unit'],
          'seer_rating': ['13', '14', '15', '16', '17', '18', '19', '20+']
        },

        // HVAC-specific compliance rules
        compliance: {
          'epa_regulations': true,
          'refrigerant_handling': 'certified_only',
          'warranty_requirements': ['manufacturer_parts', 'certified_installation'],
          'safety_protocols': ['gas_leak_detection', 'electrical_safety', 'carbon_monoxide']
        },

        // HVAC-specific integrations
        integrations: {
          'weather_service': 'openweathermap',
          'parts_suppliers': ['johnstone_supply', 'watsco', 'carrier_parts'],
          'manufacturer_apis': ['carrier', 'trane', 'lennox', 'goodman'],
          'energy_calculators': ['load_calc_pro', 'energy_star'],
          'licensing_check': 'epa_certification_db'
        },

        // HVAC-specific branding and tone
        branding: {
          'company_focus': 'energy_efficiency_comfort',
          'response_tone': 'technical_but_accessible',
          'key_messages': ['energy savings', 'comfort optimization', 'system longevity'],
          'seasonal_emphasis': true,
          'technical_depth': 'high'
        }
      },

      plumbing: {
        // Plumbing-specific intents and entities
        intents: {
          'diagnose_leak': {
            keywords: ['water leak', 'dripping', 'wet floor', 'water damage'],
            entities: ['leak_location', 'water_pressure', 'pipe_type'],
            priority: 'urgent'
          },
          'unclog_drain': {
            keywords: ['clogged drain', 'slow drain', 'backup', 'overflow'],
            entities: ['drain_type', 'severity_level', 'frequency'],
            priority: 'high'
          },
          'fixture_installation': {
            keywords: ['install toilet', 'new faucet', 'shower replacement'],
            entities: ['fixture_type', 'installation_complexity', 'permits_required'],
            priority: 'medium'
          }
        },

        entities: {
          'pipe_type': ['PVC', 'Copper', 'PEX', 'Galvanized', 'Cast Iron'],
          'fixture_type': ['Toilet', 'Faucet', 'Shower', 'Bathtub', 'Sink', 'Water Heater'],
          'leak_location': ['Under Sink', 'Toilet Base', 'Shower', 'Basement', 'Ceiling'],
          'water_pressure': ['Low', 'Normal', 'High', 'Variable']
        },

        compliance: {
          'health_codes': true,
          'potable_water_standards': 'strict',
          'backflow_prevention': 'required',
          'lead_regulations': 'epa_compliant',
          'permit_requirements': ['gas_lines', 'main_water_connection', 'septic_work']
        },

        integrations: {
          'utility_apis': ['water_dept', 'gas_utility', 'permit_office'],
          'suppliers': ['ferguson', 'home_depot_pro', 'plumbing_supply_co'],
          'leak_detection': ['smart_water_sensors', 'pressure_monitoring'],
          'licensing_check': 'state_plumbing_board',
          'emergency_shutoff': 'utility_emergency_apis'
        },

        branding: {
          'company_focus': 'reliability_water_conservation',
          'response_tone': 'practical_reassuring',
          'key_messages': ['water conservation', 'leak prevention', 'emergency response'],
          'seasonal_emphasis': false,
          'technical_depth': 'medium'
        }
      },

      electrical: {
        intents: {
          'diagnose_outage': {
            keywords: ['no power', 'lights out', 'breaker tripped', 'electrical problem'],
            entities: ['circuit_type', 'voltage_level', 'safety_hazard'],
            priority: 'urgent'
          },
          'upgrade_panel': {
            keywords: ['panel upgrade', 'increase capacity', 'new circuits'],
            entities: ['current_amperage', 'desired_capacity', 'permit_status'],
            priority: 'medium'
          }
        },

        entities: {
          'circuit_type': ['15A', '20A', '30A', '50A', 'GFCI', 'AFCI'],
          'voltage_level': ['120V', '240V', '480V'],
          'wire_type': ['Romex', 'THHN', 'THWN', 'MC Cable', 'Conduit']
        },

        compliance: {
          'nec_standards': true,
          'permit_requirements': 'all_major_work',
          'inspection_protocols': 'mandatory',
          'safety_standards': 'osha_compliant'
        },

        integrations: {
          'permit_systems': ['local_building_dept', 'electrical_inspector'],
          'suppliers': ['electrical_wholesaler', 'graybar', 'rexel'],
          'safety_monitoring': ['arc_fault_detection', 'ground_fault_monitoring'],
          'licensing_check': 'state_electrical_board'
        },

        branding: {
          'company_focus': 'safety_code_compliance',
          'response_tone': 'safety_first_professional',
          'key_messages': ['electrical safety', 'code compliance', 'fire prevention'],
          'seasonal_emphasis': false,
          'technical_depth': 'very_high'
        }
      }
    };

    return industryConfigs[this.industryType] || industryConfigs.hvac;
  }

  // Get tenant-specific intent configuration
  getIntentConfig(intentName) {
    return this.config.intents[intentName];
  }

  // Get tenant-specific entity values
  getEntityValues(entityName) {
    return this.config.entities[entityName] || [];
  }

  // Check compliance requirements
  getComplianceRules() {
    return this.config.compliance;
  }

  // Get integration endpoints
  getIntegrations() {
    return this.config.integrations;
  }

  // Get branding configuration
  getBrandingConfig() {
    return this.config.branding;
  }
}

// 2. TENANT-AWARE INTENT CLASSIFIER
class TenantIntentClassifier {
  constructor(tenantConfig) {
    this.tenantConfig = tenantConfig;
    this.industryType = tenantConfig.industryType;
  }

  classifyIntent(userInput) {
    console.log(`🔍 [${this.industryType.toUpperCase()}] Classifying intent: "${userInput}"`);
    
    const normalizedInput = userInput.toLowerCase();
    const results = [];

    // Score each intent based on tenant-specific configuration
    for (const [intentName, intentConfig] of Object.entries(this.tenantConfig.config.intents)) {
      let score = 0;
      let matchDetails = [];

      // Check keyword matches
      for (const keyword of intentConfig.keywords) {
        if (normalizedInput.includes(keyword.toLowerCase())) {
          score += 3;
          matchDetails.push(`keyword: ${keyword}`);
        }
      }

      // Check entity presence
      for (const entityType of intentConfig.entities) {
        const entityValues = this.tenantConfig.getEntityValues(entityType);
        for (const value of entityValues) {
          if (normalizedInput.includes(value.toLowerCase())) {
            score += 2;
            matchDetails.push(`entity: ${entityType}=${value}`);
          }
        }
      }

      // Apply priority weighting
      const priorityWeights = { 'urgent': 1.5, 'high': 1.2, 'medium': 1.0, 'low': 0.8 };
      score *= priorityWeights[intentConfig.priority] || 1.0;

      if (score > 0) {
        results.push({
          intent: intentName,
          score,
          priority: intentConfig.priority,
          matchDetails,
          confidence: Math.min(score / 10, 1)
        });
      }
    }

    // Sort by score and return best match
    results.sort((a, b) => b.score - a.score);
    
    if (results.length > 0) {
      console.log(`✅ [${this.industryType.toUpperCase()}] Best intent: ${results[0].intent} (${results[0].confidence.toFixed(2)})`);
      return results[0];
    }

    console.log(`❌ [${this.industryType.toUpperCase()}] No intent matched`);
    return null;
  }
}

// 3. TENANT-SPECIFIC RESPONSE GENERATOR
class TenantResponseGenerator {
  constructor(tenantConfig) {
    this.tenantConfig = tenantConfig;
    this.branding = tenantConfig.getBrandingConfig();
  }

  generateResponse(intent, entities, context = {}) {
    const industryType = this.tenantConfig.industryType;
    
    // Industry-specific response templates
    const responseTemplates = {
      hvac: {
        'diagnose_cooling_issue': this.generateHVACCoolingResponse,
        'schedule_maintenance': this.generateHVACMaintenanceResponse,
        'emergency_heating': this.generateHVACEmergencyResponse
      },
      plumbing: {
        'diagnose_leak': this.generatePlumbingLeakResponse,
        'unclog_drain': this.generatePlumbingDrainResponse,
        'fixture_installation': this.generatePlumbingInstallResponse
      },
      electrical: {
        'diagnose_outage': this.generateElectricalOutageResponse,
        'upgrade_panel': this.generateElectricalUpgradeResponse
      }
    };

    const generator = responseTemplates[industryType]?.[intent];
    if (generator) {
      return generator.call(this, entities, context);
    }

    return this.generateGenericResponse(intent, entities);
  }

  // HVAC-specific responses
  generateHVACCoolingResponse(entities, context) {
    const response = `I understand your AC isn't cooling properly. This could be related to several factors including thermostat settings, refrigerant levels, or system maintenance needs.

**Immediate Steps:**
1. Check thermostat settings (should be 3-5°F below current temp)
2. Verify air filter isn't clogged (replace if dirty)
3. Ensure all vents are open and unobstructed

**Our $49 diagnostic service** includes:
- Complete system inspection
- Refrigerant level check
- Electrical component testing
- Performance efficiency analysis

Our EPA-certified technicians can identify the exact issue and provide upfront pricing for any needed repairs. Most cooling issues are resolved the same day.

Would you like to schedule a diagnostic visit? I can check our availability for today or tomorrow.`;

    return this.applyBrandingTone(response);
  }

  generateHVACMaintenanceResponse(entities, context) {
    const response = `Great choice! Regular AC maintenance is the best way to ensure energy efficiency and prevent costly breakdowns.

**Our comprehensive $89 tune-up includes:**
- Coil cleaning and inspection
- Refrigerant level check and top-off
- Filter replacement (standard filters included)
- Electrical connections inspection
- Thermostat calibration
- Performance optimization
- 20-point safety inspection

**Energy savings benefits:**
- 15-20% improvement in efficiency
- Extended system lifespan
- Fewer emergency repairs
- Better indoor air quality

We recommend annual maintenance before peak cooling season (spring) and heating season (fall). Our service typically takes 1-2 hours and includes a detailed report with recommendations.

Would you like to schedule your maintenance service? We offer priority scheduling for maintenance customers.`;

    return this.applyBrandingTone(response);
  }

  // Plumbing-specific responses
  generatePlumbingLeakResponse(entities, context) {
    const response = `Water leaks require immediate attention to prevent property damage. Let me help you address this quickly.

**Immediate Emergency Steps:**
1. Locate your main water shutoff valve
2. Turn off water supply if leak is severe
3. Document the leak with photos for insurance
4. Move valuables away from affected area

**Our emergency response:**
- Available 24/7 for urgent leaks
- Typically arrive within 2 hours
- $89 emergency service call (applied to repairs)
- Licensed and insured for all work

**Common leak causes we address:**
- Pipe joint failures
- Fixture connection issues
- Water pressure problems
- Aging pipe materials

We'll assess the damage, stop the leak, and provide transparent pricing for permanent repairs. All our work meets local health codes and comes with warranty protection.

This sounds urgent - would you like me to dispatch a technician immediately? I can get someone to you within 2 hours.`;

    return this.applyBrandingTone(response);
  }

  // Apply tenant-specific branding and tone
  applyBrandingTone(response) {
    const tone = this.branding.response_tone;
    const keyMessages = this.branding.key_messages;
    
    // Add industry-specific emphasis based on branding config
    if (this.branding.company_focus.includes('energy_efficiency')) {
      response += `\n\n💡 **Energy Tip:** ${this.getEnergyTip()}`;
    }
    
    if (this.branding.company_focus.includes('water_conservation')) {
      response += `\n\n💧 **Conservation Tip:** ${this.getWaterTip()}`;
    }

    if (this.branding.company_focus.includes('safety')) {
      response += `\n\n⚠️ **Safety Reminder:** ${this.getSafetyTip()}`;
    }

    return response;
  }

  getEnergyTip() {
    const tips = [
      "Regular maintenance can reduce energy costs by up to 20%",
      "Upgrading to a high-efficiency system qualifies for utility rebates",
      "Smart thermostats can save $180+ annually on energy bills"
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  getWaterTip() {
    const tips = [
      "Fix leaks quickly - a single drip can waste 3,000 gallons per year",
      "Low-flow fixtures can reduce water usage by 30-50%",
      "Regular maintenance prevents emergency water damage"
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  getSafetyTip() {
    const tips = [
      "Never attempt electrical work without proper licensing",
      "Always test circuits before working on electrical systems",
      "Install GFCI outlets in wet areas for safety"
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  generateGenericResponse(intent, entities) {
    return `I understand you need assistance with ${intent.replace(/_/g, ' ')}. Let me connect you with one of our specialists who can provide detailed guidance for your specific situation.`;
  }
}

// 4. MULTI-TENANT AGENT ORCHESTRATOR
class MultiTenantAgent {
  constructor(tenantId, industryType) {
    this.tenantConfig = new TenantConfiguration(tenantId, industryType);
    this.intentClassifier = new TenantIntentClassifier(this.tenantConfig);
    this.responseGenerator = new TenantResponseGenerator(this.tenantConfig);
  }

  async processRequest(userInput, context = {}) {
    console.log(`\n🏢 [TENANT: ${this.tenantConfig.tenantId}] Processing request...`);
    console.log(`🔧 [INDUSTRY: ${this.tenantConfig.industryType.toUpperCase()}] Input: "${userInput}"`);

    // Step 1: Classify intent using tenant-specific configuration
    const intentResult = this.intentClassifier.classifyIntent(userInput);
    
    if (!intentResult) {
      return {
        success: false,
        message: "I didn't understand your request. Could you please rephrase or provide more details?",
        tenantId: this.tenantConfig.tenantId,
        industryType: this.tenantConfig.industryType
      };
    }

    // Step 2: Extract entities (simplified for demo)
    const entities = this.extractEntities(userInput, intentResult.intent);

    // Step 3: Generate tenant-specific response
    const response = this.responseGenerator.generateResponse(
      intentResult.intent, 
      entities, 
      context
    );

    // Step 4: Apply compliance checks
    const complianceCheck = this.validateCompliance(intentResult.intent, response);

    return {
      success: true,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      response: response,
      entities: entities,
      compliance: complianceCheck,
      tenantId: this.tenantConfig.tenantId,
      industryType: this.tenantConfig.industryType,
      matchDetails: intentResult.matchDetails
    };
  }

  extractEntities(userInput, intent) {
    // Simplified entity extraction - in production, use NER models
    const entities = {};
    const intentConfig = this.tenantConfig.getIntentConfig(intent);
    
    if (intentConfig) {
      for (const entityType of intentConfig.entities) {
        const possibleValues = this.tenantConfig.getEntityValues(entityType);
        for (const value of possibleValues) {
          if (userInput.toLowerCase().includes(value.toLowerCase())) {
            entities[entityType] = value;
            break;
          }
        }
      }
    }

    return entities;
  }

  validateCompliance(intent, response) {
    const complianceRules = this.tenantConfig.getComplianceRules();
    const checks = {
      passed: true,
      warnings: [],
      requirements: []
    };

    // Example compliance checks based on industry
    if (this.tenantConfig.industryType === 'hvac') {
      if (intent.includes('refrigerant') && !response.includes('EPA')) {
        checks.warnings.push('EPA compliance mention recommended for refrigerant work');
      }
    }

    if (this.tenantConfig.industryType === 'plumbing') {
      if (intent.includes('gas') && !response.includes('permit')) {
        checks.requirements.push('Gas line work requires permits and inspection');
      }
    }

    if (this.tenantConfig.industryType === 'electrical') {
      if (intent.includes('panel') && !response.includes('permit')) {
        checks.requirements.push('Panel upgrades require electrical permits');
      }
    }

    return checks;
  }
}

// 5. DEMO TESTING FUNCTION
function demonstrateMultiTenantAgent() {
  console.log('🚀 Multi-Tenant AI Agent Framework Demonstration\n');
  console.log('=' * 60);

  // Create agents for different industries
  const hvacAgent = new MultiTenantAgent('company_123', 'hvac');
  const plumbingAgent = new MultiTenantAgent('company_456', 'plumbing');
  const electricalAgent = new MultiTenantAgent('company_789', 'electrical');

  const testScenarios = [
    {
      agent: hvacAgent,
      company: 'Cool Comfort HVAC',
      input: 'My AC is not cooling properly and the thermostat shows 78 degrees'
    },
    {
      agent: plumbingAgent,
      company: 'Quick Fix Plumbing',
      input: 'I have a water leak under my kitchen sink'
    },
    {
      agent: electricalAgent,
      company: 'Safe Spark Electric',
      input: 'The power went out in my living room and the breaker tripped'
    },
    {
      agent: hvacAgent,
      company: 'Cool Comfort HVAC',
      input: 'I need to schedule annual maintenance for my Carrier unit'
    }
  ];

  // Process each scenario
  testScenarios.forEach(async (scenario, index) => {
    console.log(`\n📋 Test ${index + 1}: ${scenario.company}`);
    console.log(`❓ Customer: "${scenario.input}"`);
    console.log('-'.repeat(50));

    try {
      const result = await scenario.agent.processRequest(scenario.input);
      
      if (result.success) {
        console.log(`✅ Intent: ${result.intent} (${(result.confidence * 100).toFixed(1)}%)`);
        console.log(`🏢 Industry: ${result.industryType.toUpperCase()}`);
        console.log(`📝 Response:\n${result.response}`);
        
        if (result.entities && Object.keys(result.entities).length > 0) {
          console.log(`🔍 Entities: ${JSON.stringify(result.entities)}`);
        }
        
        if (result.compliance.warnings.length > 0) {
          console.log(`⚠️ Compliance Warnings: ${result.compliance.warnings.join(', ')}`);
        }
        
        if (result.compliance.requirements.length > 0) {
          console.log(`📋 Requirements: ${result.compliance.requirements.join(', ')}`);
        }
      } else {
        console.log(`❌ Failed: ${result.message}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  });

  console.log('\n🎉 Multi-Tenant Demonstration Complete!');
  console.log('\n📊 Key Benefits Demonstrated:');
  console.log('   ✅ Industry-specific intent classification');
  console.log('   ✅ Tenant-aware entity recognition');
  console.log('   ✅ Customized response generation');
  console.log('   ✅ Compliance validation per industry');
  console.log('   ✅ Isolated tenant configurations');
}

module.exports = {
  TenantConfiguration,
  TenantIntentClassifier,
  TenantResponseGenerator,
  MultiTenantAgent,
  demonstrateMultiTenantAgent
};

// Run demonstration
if (require.main === module) {
  demonstrateMultiTenantAgent();
}
