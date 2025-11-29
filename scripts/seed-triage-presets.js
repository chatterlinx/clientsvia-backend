#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEED TRIAGE PRESETS - Multi-Trade Preset Scenarios
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Populate TriagePresetScenario collection with starter templates
 * USAGE: node scripts/seed-triage-presets.js [--trade=HVAC] [--clear]
 * 
 * These presets appear in the LLM-A Builder "Quick Preset" dropdown
 * and can be cloned into TriageCards for any company.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TriagePresetScenario = require('../models/TriagePresetScenario');

// ═══════════════════════════════════════════════════════════════════════════
// HVAC PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const HVAC_PRESETS = [
  // Cooling / No Cool
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_AC_NOT_COOLING',
    displayName: 'AC not cooling',
    description: 'Air conditioner is running but not producing cold air',
    category: 'Cooling / No Cool',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'COOLING_NO_COOL',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['not cooling'],
      keywordsExclude: ['emergency', 'smoke', 'fire']
    },
    samplePhrases: [
      'My AC is not cooling',
      'The air conditioner is blowing warm air',
      'AC running but house is still hot'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_AC_WARM_AIR',
    displayName: 'AC blowing warm air',
    description: 'AC is blowing but air is warm/hot instead of cold',
    category: 'Cooling / No Cool',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'COOLING_NO_COOL',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['warm air'],
      keywordsExclude: ['emergency', 'smoke']
    },
    samplePhrases: [
      'My AC is blowing warm air',
      'The air coming out is hot not cold',
      'AC blowing but it feels warm'
    ],
    sortOrder: 2
  },
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_AC_NOT_TURNING_ON',
    displayName: 'AC not turning on',
    description: 'AC unit will not start or power on',
    category: 'Cooling / No Cool',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'COOLING_NO_COOL',
      serviceType: 'REPAIR',
      priority: 110,
      keywordsMustHave: ['not turning on'],
      keywordsExclude: ['emergency', 'smoke']
    },
    samplePhrases: [
      'My AC won\'t turn on',
      'The air conditioner is not starting',
      'AC unit dead, nothing happens when I turn it on'
    ],
    sortOrder: 3
  },
  // Thermostat
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_THERMOSTAT_BLANK',
    displayName: 'Thermostat blank/dead',
    description: 'Thermostat screen is blank or not displaying',
    category: 'Thermostat',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'THERMOSTAT',
      serviceType: 'REPAIR',
      priority: 90,
      keywordsMustHave: ['thermostat', 'blank'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My thermostat screen is blank',
      'Thermostat is dead',
      'Nothing showing on the thermostat'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_THERMOSTAT_NOT_RESPONDING',
    displayName: 'Thermostat not responding',
    description: 'Thermostat shows display but doesn\'t control the system',
    category: 'Thermostat',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'THERMOSTAT',
      serviceType: 'REPAIR',
      priority: 90,
      keywordsMustHave: ['thermostat', 'not responding'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My thermostat is not responding',
      'I change the temperature but nothing happens',
      'Thermostat won\'t control the AC'
    ],
    sortOrder: 11
  },
  // Heating
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_HEAT_NOT_WORKING',
    displayName: 'Heat not working',
    description: 'Heating system not producing warm air',
    category: 'Heating',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'HEATING',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['heat', 'not working'],
      keywordsExclude: ['emergency', 'gas smell']
    },
    samplePhrases: [
      'My heat is not working',
      'The furnace is not heating',
      'No heat coming from the vents'
    ],
    sortOrder: 20
  },
  // Maintenance
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_AC_TUNEUP',
    displayName: 'AC tune-up / maintenance',
    description: 'Routine AC maintenance or tune-up request',
    category: 'Maintenance',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'MAINTENANCE',
      triageCategory: 'MAINTENANCE',
      serviceType: 'MAINTENANCE',
      priority: 50,
      keywordsMustHave: ['tuneup'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I need an AC tune-up',
      'Want to schedule AC maintenance',
      'Time for my yearly AC checkup'
    ],
    sortOrder: 30
  },
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_FURNACE_TUNEUP',
    displayName: 'Furnace tune-up / maintenance',
    description: 'Routine furnace maintenance or tune-up request',
    category: 'Maintenance',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'MAINTENANCE',
      triageCategory: 'MAINTENANCE',
      serviceType: 'MAINTENANCE',
      priority: 50,
      keywordsMustHave: ['furnace', 'tuneup'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I need a furnace tune-up',
      'Want to schedule furnace maintenance',
      'Annual furnace checkup needed'
    ],
    sortOrder: 31
  },
  // Emergency
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_EMERGENCY',
    displayName: 'HVAC emergency',
    description: 'Smoke, fire, gas smell, or safety issue',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['emergency'],
      keywordsExclude: []
    },
    samplePhrases: [
      'This is an emergency',
      'Smoke coming from my vents',
      'I smell gas from the furnace',
      'My AC unit is on fire'
    ],
    sortOrder: 100
  },
  // New System
  {
    tradeKey: 'HVAC',
    presetKey: 'HVAC_NEW_SYSTEM_ESTIMATE',
    displayName: 'New system estimate',
    description: 'Quote for new AC/heating system installation',
    category: 'Sales',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'SALES',
      serviceType: 'OTHER',
      priority: 80,
      keywordsMustHave: ['new system'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I need a quote for a new AC',
      'How much for a new system?',
      'Want to replace my old unit'
    ],
    sortOrder: 40
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// PLUMBING PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const PLUMBING_PRESETS = [
  // Clogs
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_DRAIN_CLOGGED',
    displayName: 'Clogged drain',
    description: 'Sink, shower, or floor drain is clogged',
    category: 'Clogs',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'CLOGS',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['clogged', 'drain'],
      keywordsExclude: ['sewage', 'backup']
    },
    samplePhrases: [
      'My drain is clogged',
      'Sink won\'t drain',
      'Water backing up in the shower'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_TOILET_CLOGGED',
    displayName: 'Toilet clogged',
    description: 'Toilet is clogged and won\'t flush',
    category: 'Clogs',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'CLOGS',
      serviceType: 'REPAIR',
      priority: 110,
      keywordsMustHave: ['toilet', 'clogged'],
      keywordsExclude: ['overflowing', 'sewage']
    },
    samplePhrases: [
      'My toilet is clogged',
      'Toilet won\'t flush',
      'Need help with a clogged toilet'
    ],
    sortOrder: 2
  },
  // Leaks
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_FAUCET_LEAK',
    displayName: 'Leaky faucet',
    description: 'Faucet is dripping or leaking',
    category: 'Leaks',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'LEAKS',
      serviceType: 'REPAIR',
      priority: 80,
      keywordsMustHave: ['faucet', 'leak'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My faucet is leaking',
      'Dripping faucet needs repair',
      'Kitchen faucet won\'t stop dripping'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_PIPE_LEAK',
    displayName: 'Pipe leak',
    description: 'Leaking pipe under sink or in wall',
    category: 'Leaks',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'LEAKS',
      serviceType: 'REPAIR',
      priority: 120,
      keywordsMustHave: ['pipe', 'leak'],
      keywordsExclude: ['burst', 'flooding']
    },
    samplePhrases: [
      'I have a pipe leak',
      'Pipe leaking under the sink',
      'Water dripping from a pipe'
    ],
    sortOrder: 11
  },
  // Water Heater
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_NO_HOT_WATER',
    displayName: 'No hot water',
    description: 'Water heater not producing hot water',
    category: 'Water Heater',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'WATER_HEATER',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['no hot water'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I have no hot water',
      'Water heater not working',
      'Only cold water coming out'
    ],
    sortOrder: 20
  },
  // Emergency
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_BURST_PIPE',
    displayName: 'Burst pipe',
    description: 'Pipe has burst - water flooding',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['burst'],
      keywordsExclude: []
    },
    samplePhrases: [
      'A pipe burst',
      'Water everywhere, pipe exploded',
      'Flooding from a burst pipe'
    ],
    sortOrder: 100
  },
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_SEWAGE_BACKUP',
    displayName: 'Sewage backup',
    description: 'Sewage backing up into home',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['sewage'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Sewage backing up',
      'Sewage coming up in the toilet',
      'Sewer smell and backup'
    ],
    sortOrder: 101
  },
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_TOILET_OVERFLOW',
    displayName: 'Toilet overflowing',
    description: 'Toilet actively overflowing onto floor',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['toilet', 'overflowing'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Toilet is overflowing',
      'Toilet won\'t stop overflowing',
      'Water all over the bathroom floor'
    ],
    sortOrder: 102
  },
  // Maintenance
  {
    tradeKey: 'PLUMBING',
    presetKey: 'PLUMBING_DRAIN_CLEANING',
    displayName: 'Drain cleaning',
    description: 'Preventive drain cleaning service',
    category: 'Maintenance',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'MAINTENANCE',
      triageCategory: 'MAINTENANCE',
      serviceType: 'MAINTENANCE',
      priority: 50,
      keywordsMustHave: ['drain', 'cleaning'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need drain cleaning',
      'Want to schedule drain cleaning',
      'Preventive drain service'
    ],
    sortOrder: 30
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// DENTAL PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const DENTAL_PRESETS = [
  // Appointments
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_SCHEDULE_CLEANING',
    displayName: 'Schedule cleaning',
    description: 'Routine dental cleaning appointment',
    category: 'Appointments',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SCHEDULING',
      triageCategory: 'APPOINTMENTS',
      serviceType: 'MAINTENANCE',
      priority: 50,
      keywordsMustHave: ['cleaning'],
      keywordsExclude: ['emergency', 'pain']
    },
    samplePhrases: [
      'I need to schedule a cleaning',
      'Want to book a dental cleaning',
      'Time for my 6-month cleaning'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_SCHEDULE_CHECKUP',
    displayName: 'Schedule checkup',
    description: 'Routine dental checkup/exam',
    category: 'Appointments',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SCHEDULING',
      triageCategory: 'APPOINTMENTS',
      serviceType: 'MAINTENANCE',
      priority: 50,
      keywordsMustHave: ['checkup'],
      keywordsExclude: ['emergency', 'pain']
    },
    samplePhrases: [
      'I need a dental checkup',
      'Want to schedule my annual exam',
      'Book a checkup appointment'
    ],
    sortOrder: 2
  },
  // Pain / Issues
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_TOOTH_PAIN',
    displayName: 'Tooth pain',
    description: 'Patient experiencing tooth pain',
    category: 'Pain / Issues',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'PAIN',
      serviceType: 'REPAIR',
      priority: 120,
      keywordsMustHave: ['tooth', 'pain'],
      keywordsExclude: ['severe', 'unbearable', 'swelling']
    },
    samplePhrases: [
      'I have tooth pain',
      'My tooth hurts',
      'Pain in one of my teeth'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_BROKEN_TOOTH',
    displayName: 'Broken/chipped tooth',
    description: 'Tooth is broken, chipped, or cracked',
    category: 'Pain / Issues',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'REPAIR',
      serviceType: 'REPAIR',
      priority: 130,
      keywordsMustHave: ['broken', 'tooth'],
      keywordsExclude: ['bleeding', 'swelling']
    },
    samplePhrases: [
      'I broke a tooth',
      'My tooth is chipped',
      'Cracked tooth needs repair'
    ],
    sortOrder: 11
  },
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_LOST_FILLING',
    displayName: 'Lost filling/crown',
    description: 'Filling or crown has fallen out',
    category: 'Pain / Issues',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'REPAIR',
      serviceType: 'REPAIR',
      priority: 110,
      keywordsMustHave: ['filling'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My filling fell out',
      'Lost a crown',
      'Crown came off my tooth'
    ],
    sortOrder: 12
  },
  // Emergency
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_SEVERE_PAIN',
    displayName: 'Severe tooth pain',
    description: 'Unbearable tooth pain requiring urgent care',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['severe', 'pain'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Severe tooth pain',
      'The pain is unbearable',
      'I can\'t take the pain anymore'
    ],
    sortOrder: 100
  },
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_BLEEDING',
    displayName: 'Dental bleeding',
    description: 'Bleeding that won\'t stop',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['bleeding'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My mouth is bleeding',
      'Bleeding won\'t stop',
      'Tooth socket still bleeding'
    ],
    sortOrder: 101
  },
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_SWELLING',
    displayName: 'Face/jaw swelling',
    description: 'Swelling in face or jaw area',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['swelling'],
      keywordsExclude: []
    },
    samplePhrases: [
      'My face is swelling',
      'Jaw is swollen',
      'Cheek swelling up'
    ],
    sortOrder: 102
  },
  // New Patient
  {
    tradeKey: 'DENTAL',
    presetKey: 'DENTAL_NEW_PATIENT',
    displayName: 'New patient inquiry',
    description: 'New patient wanting to become a patient',
    category: 'New Patients',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'GENERAL_QUESTION',
      triageCategory: 'NEW_PATIENT',
      serviceType: 'OTHER',
      priority: 70,
      keywordsMustHave: ['new patient'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I\'m a new patient',
      'Want to become a patient',
      'Are you accepting new patients?'
    ],
    sortOrder: 50
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNTING PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const ACCOUNTING_PRESETS = [
  // Tax Services
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_TAX_RETURN',
    displayName: 'File tax return',
    description: 'Individual or business tax return filing',
    category: 'Tax Services',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'TAX_SERVICES',
      serviceType: 'OTHER',
      priority: 100,
      keywordsMustHave: ['tax return'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I need to file my taxes',
      'Looking for help with tax return',
      'Need someone to do my taxes'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_TAX_PLANNING',
    displayName: 'Tax planning',
    description: 'Tax planning and strategy consultation',
    category: 'Tax Services',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'TAX_SERVICES',
      serviceType: 'OTHER',
      priority: 90,
      keywordsMustHave: ['tax planning'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need help with tax planning',
      'Want to minimize my taxes',
      'Looking for tax strategy advice'
    ],
    sortOrder: 2
  },
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_IRS_ISSUE',
    displayName: 'IRS notice/audit',
    description: 'Help with IRS notice, audit, or problem',
    category: 'Tax Services',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'TAX_PROBLEM',
      serviceType: 'REPAIR',
      priority: 150,
      keywordsMustHave: ['irs'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I got a letter from the IRS',
      'Being audited by the IRS',
      'IRS says I owe money'
    ],
    sortOrder: 3
  },
  // Bookkeeping
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_BOOKKEEPING',
    displayName: 'Bookkeeping services',
    description: 'Monthly bookkeeping and record keeping',
    category: 'Bookkeeping',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'BOOKKEEPING',
      serviceType: 'MAINTENANCE',
      priority: 80,
      keywordsMustHave: ['bookkeeping'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need bookkeeping help',
      'Looking for a bookkeeper',
      'Monthly bookkeeping services'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_PAYROLL',
    displayName: 'Payroll services',
    description: 'Payroll processing and management',
    category: 'Bookkeeping',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'PAYROLL',
      serviceType: 'MAINTENANCE',
      priority: 80,
      keywordsMustHave: ['payroll'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need help with payroll',
      'Looking for payroll services',
      'Payroll processing for my business'
    ],
    sortOrder: 11
  },
  // Business Services
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_NEW_BUSINESS',
    displayName: 'New business setup',
    description: 'Help starting a new business, LLC, etc.',
    category: 'Business Services',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'BUSINESS_SETUP',
      serviceType: 'OTHER',
      priority: 90,
      keywordsMustHave: ['new business'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Starting a new business',
      'Need help forming an LLC',
      'Want to set up a business entity'
    ],
    sortOrder: 20
  },
  // Existing Client
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_CLIENT_QUESTION',
    displayName: 'Existing client question',
    description: 'Current client with question about their account',
    category: 'Client Services',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'GENERAL_QUESTION',
      triageCategory: 'CLIENT_SERVICES',
      serviceType: 'OTHER',
      priority: 100,
      keywordsMustHave: ['question'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I have a question about my account',
      'Need to ask my accountant something',
      'Quick question about my taxes'
    ],
    sortOrder: 30
  },
  // Deadline Urgency
  {
    tradeKey: 'ACCOUNTING',
    presetKey: 'ACCT_DEADLINE_URGENT',
    displayName: 'Urgent deadline',
    description: 'Tax or filing deadline approaching',
    category: 'Urgent',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'URGENT',
      serviceType: 'EMERGENCY',
      priority: 180,
      keywordsMustHave: ['deadline'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Tax deadline is tomorrow',
      'Need to file urgently',
      'Filing deadline approaching'
    ],
    sortOrder: 100
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// ELECTRICAL PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const ELECTRICAL_PRESETS = [
  // Outlets & Switches
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_OUTLET_NOT_WORKING',
    displayName: 'Outlet not working',
    description: 'Electrical outlet has no power',
    category: 'Outlets & Switches',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'OUTLETS',
      serviceType: 'REPAIR',
      priority: 100,
      keywordsMustHave: ['outlet', 'not working'],
      keywordsExclude: ['sparking', 'smoking', 'burning']
    },
    samplePhrases: [
      'My outlet is not working',
      'No power from the outlet',
      'Outlet stopped working'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_LIGHT_NOT_WORKING',
    displayName: 'Light not working',
    description: 'Light fixture not turning on',
    category: 'Outlets & Switches',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'LIGHTING',
      serviceType: 'REPAIR',
      priority: 90,
      keywordsMustHave: ['light', 'not working'],
      keywordsExclude: ['flickering']
    },
    samplePhrases: [
      'My light won\'t turn on',
      'Light fixture not working',
      'Lights went out in one room'
    ],
    sortOrder: 2
  },
  // Panel & Breaker
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_BREAKER_TRIPPING',
    displayName: 'Breaker keeps tripping',
    description: 'Circuit breaker repeatedly trips',
    category: 'Panel & Breaker',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SERVICE_REPAIR',
      triageCategory: 'PANEL',
      serviceType: 'REPAIR',
      priority: 130,
      keywordsMustHave: ['breaker', 'tripping'],
      keywordsExclude: ['hot', 'burning']
    },
    samplePhrases: [
      'My breaker keeps tripping',
      'Circuit breaker won\'t stay on',
      'Breaker trips every day'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_PANEL_UPGRADE',
    displayName: 'Panel upgrade',
    description: 'Upgrade electrical panel capacity',
    category: 'Panel & Breaker',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'UPGRADE',
      serviceType: 'OTHER',
      priority: 80,
      keywordsMustHave: ['panel', 'upgrade'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need to upgrade my panel',
      'Want a 200 amp panel',
      'Panel upgrade quote'
    ],
    sortOrder: 11
  },
  // Emergency
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_SPARKING',
    displayName: 'Sparking outlet/switch',
    description: 'Sparks visible from outlet or switch',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['sparking'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Outlet is sparking',
      'Sparks when I plug something in',
      'Switch is sparking'
    ],
    sortOrder: 100
  },
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_BURNING_SMELL',
    displayName: 'Burning smell',
    description: 'Electrical burning smell',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 200,
      keywordsMustHave: ['burning smell'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Burning smell from outlet',
      'Something smells like it\'s burning',
      'Electrical burning smell in house'
    ],
    sortOrder: 101
  },
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_NO_POWER',
    displayName: 'No power (partial)',
    description: 'Part of house has no power',
    category: 'Emergency',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'EMERGENCY',
      triageCategory: 'EMERGENCY',
      serviceType: 'EMERGENCY',
      priority: 180,
      keywordsMustHave: ['no power'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Half my house has no power',
      'Lost power to part of the house',
      'Some rooms have no electricity'
    ],
    sortOrder: 102
  },
  // Installation
  {
    tradeKey: 'ELECTRICAL',
    presetKey: 'ELEC_EV_CHARGER',
    displayName: 'EV charger install',
    description: 'Electric vehicle charger installation',
    category: 'Installation',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'INSTALLATION',
      serviceType: 'OTHER',
      priority: 80,
      keywordsMustHave: ['ev charger'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Need an EV charger installed',
      'Electric car charger installation',
      'Install Tesla charger'
    ],
    sortOrder: 20
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// GENERAL PRESETS (Works for any trade)
// ═══════════════════════════════════════════════════════════════════════════

const GENERAL_PRESETS = [
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_SCHEDULE_SERVICE',
    displayName: 'Schedule service',
    description: 'Generic service scheduling request',
    category: 'Scheduling',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'SCHEDULING',
      triageCategory: 'SCHEDULING',
      serviceType: 'OTHER',
      priority: 80,
      keywordsMustHave: ['schedule'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I need to schedule service',
      'Want to book an appointment',
      'Schedule a visit'
    ],
    sortOrder: 1
  },
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_QUOTE_REQUEST',
    displayName: 'Request a quote',
    description: 'Price estimate or quote request',
    category: 'Sales',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'NEW_SALES_ESTIMATE',
      triageCategory: 'SALES',
      serviceType: 'OTHER',
      priority: 80,
      keywordsMustHave: ['quote'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Can I get a quote?',
      'How much would it cost?',
      'I need a price estimate'
    ],
    sortOrder: 2
  },
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_BILLING_QUESTION',
    displayName: 'Billing question',
    description: 'Question about invoice or payment',
    category: 'Billing',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'BILLING_ISSUE',
      triageCategory: 'BILLING',
      serviceType: 'OTHER',
      priority: 100,
      keywordsMustHave: ['bill'],
      keywordsExclude: ['dispute', 'wrong', 'overcharged']
    },
    samplePhrases: [
      'Question about my bill',
      'When is payment due?',
      'How do I pay my invoice?'
    ],
    sortOrder: 10
  },
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_BILLING_DISPUTE',
    displayName: 'Billing dispute',
    description: 'Disagreement about charges',
    category: 'Billing',
    quickRuleSkeleton: {
      action: 'ESCALATE_TO_HUMAN',
      intent: 'BILLING_ISSUE',
      triageCategory: 'BILLING_DISPUTE',
      serviceType: 'OTHER',
      priority: 150,
      keywordsMustHave: ['dispute'],
      keywordsExclude: []
    },
    samplePhrases: [
      'I want to dispute a charge',
      'You overcharged me',
      'This bill is wrong'
    ],
    sortOrder: 11
  },
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_HOURS',
    displayName: 'Hours/location question',
    description: 'Question about business hours or location',
    category: 'General Info',
    quickRuleSkeleton: {
      action: 'DIRECT_TO_3TIER',
      intent: 'GENERAL_QUESTION',
      triageCategory: 'INFO',
      serviceType: 'OTHER',
      priority: 50,
      keywordsMustHave: ['hours'],
      keywordsExclude: []
    },
    samplePhrases: [
      'What are your hours?',
      'When are you open?',
      'Where are you located?'
    ],
    sortOrder: 20
  },
  {
    tradeKey: 'GENERAL',
    presetKey: 'GENERAL_CALLBACK',
    displayName: 'Request callback',
    description: 'Wants someone to call them back',
    category: 'Messages',
    quickRuleSkeleton: {
      action: 'TAKE_MESSAGE',
      intent: 'MESSAGE_ONLY',
      triageCategory: 'MESSAGE',
      serviceType: 'OTHER',
      priority: 60,
      keywordsMustHave: ['call me back'],
      keywordsExclude: []
    },
    samplePhrases: [
      'Can someone call me back?',
      'Please have someone return my call',
      'Need a callback'
    ],
    sortOrder: 30
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

async function seedPresets() {
  const args = process.argv.slice(2);
  const clearFirst = args.includes('--clear');
  const tradeFilter = args.find(a => a.startsWith('--trade='))?.split('=')[1]?.toUpperCase();
  
  // Connect to database
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // Combine all presets
  let ALL_PRESETS = [
    ...HVAC_PRESETS,
    ...PLUMBING_PRESETS,
    ...DENTAL_PRESETS,
    ...ACCOUNTING_PRESETS,
    ...ELECTRICAL_PRESETS,
    ...GENERAL_PRESETS
  ];

  // Filter by trade if specified
  if (tradeFilter) {
    ALL_PRESETS = ALL_PRESETS.filter(p => p.tradeKey === tradeFilter);
    console.log(`📋 Filtering to ${tradeFilter} presets only`);
  }

  // Clear existing presets if requested
  if (clearFirst) {
    const query = tradeFilter ? { tradeKey: tradeFilter } : {};
    const deleted = await TriagePresetScenario.deleteMany(query);
    console.log(`🗑️ Cleared ${deleted.deletedCount} existing presets\n`);
  }

  // Insert presets
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const preset of ALL_PRESETS) {
    try {
      const result = await TriagePresetScenario.findOneAndUpdate(
        { tradeKey: preset.tradeKey, presetKey: preset.presetKey },
        preset,
        { upsert: true, new: true }
      );
      
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        inserted++;
      } else {
        updated++;
      }
    } catch (err) {
      console.error(`❌ Error with ${preset.presetKey}:`, err.message);
      errors++;
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Updated:  ${updated}`);
  console.log(`   Errors:   ${errors}`);
  console.log(`   Total:    ${ALL_PRESETS.length}`);
  
  // Count by trade
  const byTrade = {};
  for (const p of ALL_PRESETS) {
    byTrade[p.tradeKey] = (byTrade[p.tradeKey] || 0) + 1;
  }
  console.log('\n📋 By Trade:');
  for (const [trade, count] of Object.entries(byTrade)) {
    console.log(`   ${trade}: ${count} presets`);
  }

  await mongoose.disconnect();
  console.log('\n👋 Done!');
}

// Run
seedPresets().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

