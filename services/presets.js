/**
 * Company Preset Catalog - Default configurations for quick onboarding
 * Feature-flagged implementation for Phase 6
 */

const flags = require('../config/flags');

const PRESET_CATALOG = {
  hvac_starter: {
    name: 'HVAC Starter',
    description: 'Ready-to-use HVAC service configuration with emergency routing',
    config: {
      agentInstructions: `You are a professional HVAC service assistant. Help customers with heating, cooling, and air quality issues.

Key responsibilities:
- Take service calls for HVAC repairs and maintenance
- Schedule appointments during business hours (Mon-Fri 8AM-6PM)
- Route emergency calls (no heat/AC in extreme weather) immediately
- Collect customer info: name, phone, address, issue description
- Always be helpful, professional, and empathetic

For emergencies, say: "I understand this is urgent. Let me connect you with our emergency technician right away."

For routine service, say: "I can schedule a technician to come out. What day works best for you?"`,

      companyInfo: {
        businessHours: 'Monday-Friday 8AM-6PM EST',
        services: 'HVAC repair, maintenance, installation, emergency service',
        serviceArea: 'Metro area and surrounding counties'
      },

      fallbackSettings: {
        voiceEnabled: true,
        transferEnabled: true,
        smsEnabled: true,
        emergencyKeywords: ['no heat', 'no cooling', 'no air', 'emergency', 'urgent', 'freezing', 'sweltering']
      },

      ttsSettings: {
        voice: 'nova',
        speed: 1.0
      }
    },
    
    // Optional: Tags for filtering
    tags: ['hvac', 'service', 'emergency', 'starter'],
    
    // Version for tracking updates
    version: '1.0'
  },

  // Future preset examples (commented out for now)
  /*
  medical_practice: {
    name: 'Medical Practice',
    description: 'HIPAA-compliant patient communication and appointment scheduling',
    config: {
      agentInstructions: 'You are a medical office assistant...',
      // ... rest of config
    },
    tags: ['medical', 'hipaa', 'appointments'],
    version: '1.0'
  },

  restaurant: {
    name: 'Restaurant',
    description: 'Reservation handling and order support',
    config: {
      agentInstructions: 'You are a friendly restaurant host...',
      // ... rest of config
    },
    tags: ['restaurant', 'reservations', 'orders'],
    version: '1.0'
  }
  */
};

/**
 * Get available presets list
 */
function getPresetList() {
  if (!flags.PRESETS_V1) {
    return [];
  }
  
  return Object.keys(PRESET_CATALOG).map(id => ({
    id,
    name: PRESET_CATALOG[id].name,
    description: PRESET_CATALOG[id].description,
    tags: PRESET_CATALOG[id].tags || [],
    version: PRESET_CATALOG[id].version
  }));
}

/**
 * Get specific preset by ID
 */
function getPreset(presetId) {
  if (!flags.PRESETS_V1) {
    return null;
  }
  
  return PRESET_CATALOG[presetId] || null;
}

/**
 * Get default preset configuration
 */
function getDefaultPreset() {
  if (!flags.PRESETS_V1) {
    return null;
  }
  
  const defaultId = flags.PRESET_DEFAULT;
  return getPreset(defaultId);
}

/**
 * Apply preset configuration to a company document
 * Returns the merged configuration without modifying the original
 */
function applyPresetToCompanyDoc(companyDoc, presetId) {
  if (!flags.PRESETS_V1) {
    return companyDoc;
  }
  
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`Preset '${presetId}' not found`);
  }
  
  // Create a deep copy to avoid mutations
  const updated = JSON.parse(JSON.stringify(companyDoc));
  
  // Apply preset config, but preserve existing values where they exist
  if (preset.config.agentInstructions && !updated.agentInstructions) {
    updated.agentInstructions = preset.config.agentInstructions;
  }
  
  if (preset.config.companyInfo) {
    updated.companyInfo = {
      ...preset.config.companyInfo,
      ...updated.companyInfo // Existing values take precedence
    };
  }
  
  if (preset.config.fallbackSettings) {
    updated.fallbackSettings = {
      ...preset.config.fallbackSettings,
      ...updated.fallbackSettings
    };
  }
  
  if (preset.config.ttsSettings) {
    updated.ttsSettings = {
      ...preset.config.ttsSettings,
      ...updated.ttsSettings
    };
  }
  
  // Track which preset was applied
  updated.appliedPreset = {
    id: presetId,
    name: preset.name,
    version: preset.version,
    appliedAt: new Date().toISOString()
  };
  
  return updated;
}

/**
 * Validate preset configuration
 */
function validatePreset(presetId) {
  const preset = getPreset(presetId);
  if (!preset) {
    return { valid: false, error: `Preset '${presetId}' not found` };
  }
  
  // Basic validation
  if (!preset.config || !preset.config.agentInstructions) {
    return { valid: false, error: 'Preset missing required agentInstructions' };
  }
  
  return { valid: true };
}

module.exports = {
  getPresetList,
  getPreset,
  getDefaultPreset,
  applyPresetToCompanyDoc,
  validatePreset,
  PRESET_CATALOG // Export for testing/debugging
};
