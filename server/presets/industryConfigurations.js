/**
 * Industry-Specific Configuration Templates
 * 
 * Each industry configuration includes:
 * - Voice settings optimized for the industry
 * - Knowledge base starter content
 * - Workflow configurations (booking types, transfer rules)
 * - Industry-specific compliance settings
 * - Agent personality and behavior settings
 */

const industryConfigurations = {
  
  // 🔧 HVAC Contractor
  hvac: {
    version: '1.0',
    knowledgeEntries: 150,
    configuration: {
      // Voice & Personality
      voiceSettings: {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
        model_id: 'eleven_turbo_v2_5'
      },
      agentPersonality: {
        name: 'Professional HVAC Assistant',
        tone: 'professional-friendly',
        expertise: 'heating-cooling-systems',
        communicationStyle: 'helpful-technical'
      },
      
      // Knowledge & Q&A
      knowledgeSources: {
        priority: ['companyQnA', 'tradeQnA', 'generalQnA'],
        thresholds: {
          companyQnA: 0.8,
          tradeQnA: 0.75,
          generalQnA: 0.7
        }
      },
      
      // Booking & Scheduling
      bookingSettings: {
        defaultServiceTypes: [
          'HVAC Maintenance',
          'Heating Repair',
          'Cooling Repair', 
          'System Installation',
          'Emergency Service'
        ],
        urgencyLevels: ['Emergency', 'Urgent', 'Standard', 'Routine'],
        defaultDuration: 90,
        emergencyAvailable: true
      },
      
      // Transfer & Escalation
      transferSettings: {
        transferReasons: ['Technical Issue', 'Pricing Question', 'Emergency', 'Scheduling'],
        escalationTriggers: ['equipment-failure', 'safety-concern', 'complex-installation']
      }
    }
  },

  // 🚿 Plumbing Services  
  plumbing: {
    version: '1.0',
    knowledgeEntries: 120,
    configuration: {
      voiceSettings: {
        stability: 0.8,
        similarity_boost: 0.75,
        style: 0.1,
        use_speaker_boost: true
      },
      agentPersonality: {
        name: 'Professional Plumbing Assistant',
        tone: 'reliable-helpful',
        expertise: 'plumbing-systems',
        communicationStyle: 'clear-practical'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Leak Repair',
          'Drain Cleaning',
          'Fixture Installation',
          'Emergency Plumbing',
          'Water Heater Service'
        ],
        emergencyAvailable: true,
        defaultDuration: 60
      }
    }
  },

  // ⚡ Electrical Services
  electrical: {
    version: '1.0', 
    knowledgeEntries: 100,
    configuration: {
      voiceSettings: {
        stability: 0.9,
        similarity_boost: 0.8,
        style: 0.0
      },
      agentPersonality: {
        name: 'Professional Electrical Assistant',
        tone: 'safety-focused',
        expertise: 'electrical-systems',
        communicationStyle: 'precise-cautious'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Electrical Repair',
          'Panel Upgrade',
          'Outlet Installation',
          'Safety Inspection',
          'Emergency Electrical'
        ],
        safetyWarnings: true,
        emergencyAvailable: true
      }
    }
  },

  // 🏗️ General Contractor
  general_contractor: {
    version: '1.0',
    knowledgeEntries: 200,
    configuration: {
      agentPersonality: {
        name: 'Professional Construction Assistant',
        tone: 'professional-detailed',
        expertise: 'construction-renovation'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Construction Consultation',
          'Home Renovation',
          'Repair Services',
          'Project Planning',
          'Estimate Request'
        ],
        consultationRequired: true,
        defaultDuration: 120
      }
    }
  },

  // 🏠 Roofing Services
  roofing: {
    version: '1.0',
    knowledgeEntries: 80,
    configuration: {
      agentPersonality: {
        name: 'Professional Roofing Assistant',
        tone: 'weather-aware',
        expertise: 'roofing-systems'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Roof Inspection',
          'Leak Repair',
          'Roof Replacement',
          'Gutter Services',
          'Emergency Repair'
        ],
        weatherDependent: true,
        emergencyAvailable: true
      }
    }
  },

  // 🚗 Auto Repair Shop
  auto_repair: {
    version: '1.0',
    knowledgeEntries: 180,
    configuration: {
      agentPersonality: {
        name: 'Professional Auto Service Assistant',
        tone: 'knowledgeable-friendly',
        expertise: 'automotive-repair'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Oil Change',
          'Brake Service',
          'Engine Diagnostic',
          'Tire Service',
          'General Maintenance'
        ],
        vehicleInfoRequired: true,
        defaultDuration: 90
      }
    }
  },

  // 🏥 Medical Practice
  medical: {
    version: '1.0',
    knowledgeEntries: 60,
    configuration: {
      agentPersonality: {
        name: 'Professional Medical Assistant',
        tone: 'caring-professional',
        expertise: 'healthcare-scheduling'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Routine Checkup',
          'Consultation',
          'Follow-up Visit',
          'Urgent Care',
          'Specialist Referral'
        ],
        hipaaCompliant: true,
        patientInfoRequired: true
      },
      complianceSettings: {
        hipaa: true,
        patientPrivacy: true,
        medicalDisclaimer: true
      }
    }
  },

  // ⚖️ Legal Services
  legal: {
    version: '1.0',
    knowledgeEntries: 90,
    configuration: {
      agentPersonality: {
        name: 'Professional Legal Assistant',
        tone: 'formal-professional',
        expertise: 'legal-consultation'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Legal Consultation',
          'Document Review',
          'Case Discussion',
          'Contract Review',
          'Legal Advice'
        ],
        consultationRequired: true,
        confidentialityNotice: true
      },
      complianceSettings: {
        attorneyClientPrivilege: true,
        conflictCheck: true,
        legalDisclaimer: true
      }
    }
  },

  // 🍽️ Restaurant/Food Service
  restaurant: {
    version: '1.0',
    knowledgeEntries: 70,
    configuration: {
      agentPersonality: {
        name: 'Friendly Restaurant Assistant',
        tone: 'warm-welcoming',
        expertise: 'hospitality-service'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Table Reservation',
          'Takeout Order',
          'Event Booking',
          'Catering Inquiry',
          'Special Occasion'
        ],
        menuIntegration: true,
        reservationSystem: true
      }
    }
  },

  // 💄 Salon & Spa
  salon_spa: {
    version: '1.0',
    knowledgeEntries: 85,
    configuration: {
      agentPersonality: {
        name: 'Friendly Beauty Assistant', 
        tone: 'warm-professional',
        expertise: 'beauty-wellness'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Hair Cut & Style',
          'Hair Color',
          'Facial Treatment',
          'Massage Therapy',
          'Nail Services'
        ],
        serviceProviderSelection: true,
        defaultDuration: 60
      }
    }
  },

  // 💪 Fitness/Gym
  fitness: {
    version: '1.0',
    knowledgeEntries: 65,
    configuration: {
      agentPersonality: {
        name: 'Energetic Fitness Assistant',
        tone: 'motivational-friendly',
        expertise: 'fitness-wellness'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Personal Training',
          'Group Class',
          'Fitness Assessment',
          'Membership Consultation',
          'Nutrition Consultation'
        ],
        trainerSelection: true,
        membershipRequired: true
      }
    }
  },

  // 🐾 Veterinary Clinic
  veterinary: {
    version: '1.0',
    knowledgeEntries: 110,
    configuration: {
      agentPersonality: {
        name: 'Caring Veterinary Assistant',
        tone: 'compassionate-professional',
        expertise: 'veterinary-care'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Wellness Exam',
          'Vaccination',
          'Sick Visit',
          'Surgery Consultation',
          'Emergency Care'
        ],
        petInfoRequired: true,
        emergencyAvailable: true
      }
    }
  },

  // 🦷 Dental Practice  
  dental: {
    version: '1.0',
    knowledgeEntries: 95,
    configuration: {
      agentPersonality: {
        name: 'Professional Dental Assistant',
        tone: 'reassuring-professional',
        expertise: 'dental-care'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Routine Cleaning',
          'Dental Exam',
          'Filling',
          'Crown/Bridge',
          'Emergency Dental'
        ],
        insuranceVerification: true,
        emergencyAvailable: true
      },
      complianceSettings: {
        hipaa: true,
        patientPrivacy: true
      }
    }
  },

  // 🏡 Real Estate
  real_estate: {
    version: '1.0',
    knowledgeEntries: 75,
    configuration: {
      agentPersonality: {
        name: 'Professional Real Estate Assistant',
        tone: 'knowledgeable-helpful',
        expertise: 'real-estate-services'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Property Showing',
          'Market Analysis',
          'Buyer Consultation',
          'Seller Consultation',
          'Investment Property Review'
        ],
        propertyInfoRequired: true,
        marketDataIntegration: true
      }
    }
  },

  // 🎯 Custom Configuration
  custom: {
    version: '1.0',
    knowledgeEntries: 0,
    configuration: {
      agentPersonality: {
        name: 'Professional Assistant',
        tone: 'professional-friendly',
        expertise: 'general-business'
      },
      bookingSettings: {
        defaultServiceTypes: [
          'Consultation',
          'Service Appointment',
          'Follow-up Meeting'
        ],
        customizable: true
      }
    }
  }
};

/**
 * Get industry configuration by type
 */
function getIndustryConfiguration(industryType) {
  return industryConfigurations[industryType] || null;
}

/**
 * Get list of all available industries
 */
function getIndustryList() {
  return Object.keys(industryConfigurations).map(key => ({
    type: key,
    name: industryConfigurations[key].configuration.agentPersonality?.name || key,
    knowledgeEntries: industryConfigurations[key].knowledgeEntries || 0,
    version: industryConfigurations[key].version || '1.0'
  }));
}

/**
 * Validate industry type exists
 */
function validateIndustryType(industryType) {
  const config = industryConfigurations[industryType];
  return {
    valid: !!config,
    error: config ? null : `Unknown industry type: ${industryType}`,
    configuration: config
  };
}

module.exports = {
  getIndustryConfiguration,
  getIndustryList,
  validateIndustryType,
  industryConfigurations
};
