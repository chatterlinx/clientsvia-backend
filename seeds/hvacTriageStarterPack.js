// seeds/hvacTriageStarterPack.js
// V22 HVAC Triage Starter Pack - Pre-built cards for common HVAC scenarios
// Run: node seeds/hvacTriageStarterPack.js <companyId>

const mongoose = require('mongoose');
require('dotenv').config();

const TriageCard = require('../models/TriageCard');

// ═══════════════════════════════════════════════════════════════════════════
// HVAC STARTER PACK - 12 ESSENTIAL CARDS
// ═══════════════════════════════════════════════════════════════════════════

const HVAC_STARTER_CARDS = [
  // ─────────────────────────────────────────────────────────────────────────
  // COOLING / NO COOL (4 cards)
  // ─────────────────────────────────────────────────────────────────────────
  {
    triageLabel: 'AC_NOT_COOLING',
    displayName: 'AC not cooling',
    description: 'Air conditioner is running but not producing cold air or not reaching thermostat setpoint.',
    intent: 'AC_REPAIR',
    triageCategory: 'COOLING_ISSUES',
    serviceType: 'REPAIR',
    priority: 100,
    quickRuleConfig: {
      keywordsMustHave: ['not cooling', 'ac', 'air conditioning'],
      keywordsExclude: ['maintenance', 'tune up', '$89'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Route AC cooling issues to repair flow'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Confirm cooling issue and route to repair visit',
      openingLines: [
        "I can help you with that AC issue. Let me get some details to schedule a repair visit.",
        "No cold air is definitely frustrating. Let's get a technician out to diagnose it."
      ],
      objectionHandling: [
        { customer: "Can you just tell me what's wrong?", agent: "There are several possible causes. A technician can diagnose it onsite and give you options." }
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Cooling / No Cool',
      scenarioName: 'AC Not Cooling – Repair Call',
      scenarioObjective: 'Confirm cooling problem, gather system details, and book repair visit',
      scenarioExamples: ['AC is running but blowing warm air', 'House won\'t cool down', 'Air conditioner not working']
    }
  },
  {
    triageLabel: 'AC_BLOWING_WARM',
    displayName: 'AC blowing warm air',
    description: 'AC system runs but produces warm or room-temperature air instead of cold.',
    intent: 'AC_REPAIR',
    triageCategory: 'COOLING_ISSUES',
    serviceType: 'REPAIR',
    priority: 95,
    quickRuleConfig: {
      keywordsMustHave: ['blowing warm', 'warm air'],
      keywordsExclude: ['heating', 'furnace'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Warm air from AC indicates repair need'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Confirm warm air issue and schedule repair',
      openingLines: [
        "If your AC is blowing warm air, make sure the thermostat is on cool and the filter is clean. If it's still warm, I can send a technician.",
        "Warm air usually means something needs attention. Let me get you scheduled for a diagnostic."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Cooling / No Cool',
      scenarioName: 'AC Blowing Warm Air',
      scenarioObjective: 'Quick troubleshooting then book repair if needed'
    }
  },
  {
    triageLabel: 'AC_NOT_TURNING_ON',
    displayName: 'AC not turning on',
    description: 'Air conditioner unit does not start or respond at all.',
    intent: 'AC_REPAIR',
    triageCategory: 'COOLING_ISSUES',
    serviceType: 'REPAIR',
    priority: 100,
    quickRuleConfig: {
      keywordsMustHave: ['not turning on', 'won\'t start', 'ac'],
      keywordsExclude: [],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Non-starting AC needs repair visit'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Check basics then schedule repair',
      openingLines: [
        "Check if the breaker or disconnect switch near the outdoor unit is on, and replace thermostat batteries if applicable. Still no power? I can send help.",
        "Let's make sure it's not a simple fix first, then get you scheduled."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Cooling / No Cool',
      scenarioName: 'AC Not Turning On',
      scenarioObjective: 'Basic troubleshooting then book diagnostic'
    }
  },
  {
    triageLabel: 'AC_SERVICE_GENERAL',
    displayName: 'General AC service request',
    description: 'Caller needs air conditioning service but hasn\'t specified the exact issue.',
    intent: 'AC_SERVICE',
    triageCategory: 'COOLING_ISSUES',
    serviceType: 'REPAIR',
    priority: 80,
    quickRuleConfig: {
      keywordsMustHave: ['air conditioning service', 'ac service', 'cooling service'],
      keywordsExclude: ['maintenance', 'tune up'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'General AC service requests go to repair flow'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Clarify issue and route appropriately',
      openingLines: [
        "I'd be happy to help with your AC. Can you tell me what's going on with it?",
        "Of course! What seems to be the issue with your air conditioning?"
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Cooling / No Cool',
      scenarioName: 'General AC Service',
      scenarioObjective: 'Gather details and route to appropriate repair flow'
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HEATING ISSUES (3 cards)
  // ─────────────────────────────────────────────────────────────────────────
  {
    triageLabel: 'HEAT_NOT_WORKING',
    displayName: 'Heat not working',
    description: 'Heating system is not producing warm air or not turning on.',
    intent: 'HEATING_REPAIR',
    triageCategory: 'HEATING_ISSUES',
    serviceType: 'REPAIR',
    priority: 100,
    quickRuleConfig: {
      keywordsMustHave: ['heat', 'not working'],
      keywordsExclude: ['ac', 'cooling', 'air conditioning'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'No heat is urgent, route to repair'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Confirm heating issue and schedule repair',
      openingLines: [
        "No heat is definitely urgent, especially in cold weather. Let me get you scheduled for a repair visit.",
        "I understand how uncomfortable that is. Let's get a technician out to take a look."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Heating Issues',
      scenarioName: 'Heat Not Working',
      scenarioObjective: 'Confirm no heat situation and book repair'
    }
  },
  {
    triageLabel: 'FURNACE_NOT_IGNITING',
    displayName: 'Furnace not igniting',
    description: 'Gas furnace clicks or tries to start but doesn\'t ignite or stay lit.',
    intent: 'HEATING_REPAIR',
    triageCategory: 'HEATING_ISSUES',
    serviceType: 'REPAIR',
    priority: 95,
    quickRuleConfig: {
      keywordsMustHave: ['furnace', 'not igniting'],
      keywordsExclude: [],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Ignition issues need professional diagnosis'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Route to furnace repair',
      openingLines: [
        "Furnace ignition issues can have several causes. A technician can safely diagnose and repair it.",
        "That's something our techs see often. Let me get you scheduled for a repair visit."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Heating Issues',
      scenarioName: 'Furnace Not Igniting',
      scenarioObjective: 'Book furnace repair visit'
    }
  },
  {
    triageLabel: 'HEAT_PUMP_ISSUES',
    displayName: 'Heat pump not heating',
    description: 'Heat pump system not providing adequate heat or running in emergency/aux mode constantly.',
    intent: 'HEATING_REPAIR',
    triageCategory: 'HEATING_ISSUES',
    serviceType: 'REPAIR',
    priority: 90,
    quickRuleConfig: {
      keywordsMustHave: ['heat pump', 'not heating'],
      keywordsExclude: [],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Heat pump issues need repair'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Route heat pump issues to repair',
      openingLines: [
        "Heat pump systems can be tricky. Let me get a technician out to diagnose it properly.",
        "Is your heat pump running but not warming the house? Our techs can take a look."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Heating Issues',
      scenarioName: 'Heat Pump Issues',
      scenarioObjective: 'Diagnose and repair heat pump'
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THERMOSTAT (2 cards)
  // ─────────────────────────────────────────────────────────────────────────
  {
    triageLabel: 'THERMOSTAT_BLANK',
    displayName: 'Thermostat blank/dead',
    description: 'Thermostat display is blank, unresponsive, or not powering on.',
    intent: 'THERMOSTAT_ISSUE',
    triageCategory: 'THERMOSTAT',
    serviceType: 'REPAIR',
    priority: 85,
    quickRuleConfig: {
      keywordsMustHave: ['thermostat', 'blank'],
      keywordsExclude: [],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Blank thermostat needs diagnosis'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Quick battery check then schedule if needed',
      openingLines: [
        "A blank thermostat can be a simple battery issue or something more. Try replacing the batteries first. If it's still blank, I can send a tech.",
        "Let's try a quick fix first. Replace the batteries and see if it comes back on."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Thermostat',
      scenarioName: 'Thermostat Blank/Dead',
      scenarioObjective: 'Troubleshoot then book service if needed'
    }
  },
  {
    triageLabel: 'THERMOSTAT_NOT_RESPONDING',
    displayName: 'Thermostat not responding',
    description: 'Thermostat has power but system doesn\'t respond to temperature changes.',
    intent: 'THERMOSTAT_ISSUE',
    triageCategory: 'THERMOSTAT',
    serviceType: 'REPAIR',
    priority: 80,
    quickRuleConfig: {
      keywordsMustHave: ['thermostat', 'not responding'],
      keywordsExclude: [],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Non-responsive thermostat needs service'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Schedule diagnostic',
      openingLines: [
        "If your thermostat has power but the system isn't responding, there could be a wiring or equipment issue. Let's get it checked out.",
        "That sounds like it needs a professional look. I can schedule a diagnostic visit."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Thermostat',
      scenarioName: 'Thermostat Not Responding',
      scenarioObjective: 'Diagnose communication issue'
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MAINTENANCE (2 cards)
  // ─────────────────────────────────────────────────────────────────────────
  {
    triageLabel: 'AC_TUNE_UP',
    displayName: 'AC tune-up / maintenance',
    description: 'Caller wants preventive maintenance or seasonal tune-up for their AC.',
    intent: 'MAINTENANCE',
    triageCategory: 'MAINTENANCE',
    serviceType: 'MAINTENANCE',
    priority: 70,
    quickRuleConfig: {
      keywordsMustHave: ['tune up', 'maintenance', 'ac'],
      keywordsExclude: ['not working', 'broken', 'emergency'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Route maintenance requests to booking'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Book maintenance appointment',
      openingLines: [
        "Great idea to get a tune-up! Regular maintenance keeps your system running efficiently. Let me get you scheduled.",
        "Preventive maintenance is smart. We can get you on the schedule for a tune-up."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Maintenance',
      scenarioName: 'AC Tune-Up',
      scenarioObjective: 'Book preventive maintenance visit'
    }
  },
  {
    triageLabel: 'FURNACE_TUNE_UP',
    displayName: 'Furnace tune-up / maintenance',
    description: 'Caller wants preventive maintenance or seasonal tune-up for their furnace.',
    intent: 'MAINTENANCE',
    triageCategory: 'MAINTENANCE',
    serviceType: 'MAINTENANCE',
    priority: 70,
    quickRuleConfig: {
      keywordsMustHave: ['tune up', 'maintenance', 'furnace'],
      keywordsExclude: ['not working', 'broken', 'emergency'],
      action: 'DIRECT_TO_3TIER',
      explanation: 'Route furnace maintenance to booking'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Book furnace maintenance',
      openingLines: [
        "Getting your furnace tuned up before winter is a great idea. Let me get you scheduled.",
        "Annual furnace maintenance helps prevent breakdowns. I can book that for you."
      ]
    },
    threeTierPackageDraft: {
      categoryName: 'Maintenance',
      scenarioName: 'Furnace Tune-Up',
      scenarioObjective: 'Book preventive furnace maintenance'
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EMERGENCY (1 card)
  // ─────────────────────────────────────────────────────────────────────────
  {
    triageLabel: 'HVAC_EMERGENCY',
    displayName: 'HVAC emergency',
    description: 'Urgent HVAC situation requiring immediate attention (gas smell, no heat in freezing temps, etc.).',
    intent: 'EMERGENCY',
    triageCategory: 'EMERGENCY',
    serviceType: 'EMERGENCY',
    priority: 150,
    quickRuleConfig: {
      keywordsMustHave: ['emergency', 'urgent'],
      keywordsExclude: [],
      action: 'ESCALATE_TO_HUMAN',
      explanation: 'Emergencies get transferred to dispatch immediately'
    },
    frontlinePlaybook: {
      frontlineGoal: 'Transfer to human immediately',
      openingLines: [
        "I understand this is urgent. Let me transfer you to our emergency dispatch right away.",
        "For emergencies, I need to connect you with our team immediately. Please hold."
      ]
    },
    actionPlaybooks: {
      escalateToHuman: {
        reasonLabel: 'HVAC Emergency',
        preTransferLines: [
          "This sounds like it needs immediate attention. Let me connect you with our emergency team.",
          "I'm transferring you to dispatch right now. They can get someone out to you quickly."
        ]
      }
    },
    threeTierPackageDraft: {
      categoryName: 'Emergency',
      scenarioName: 'HVAC Emergency',
      scenarioObjective: 'Immediate transfer to human dispatch'
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// SEED FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

async function seedHVACStarterPack(companyId, options = {}) {
  const { activate = false, dryRun = false } = options;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🌱 HVAC TRIAGE STARTER PACK SEEDER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!companyId) {
    throw new Error('companyId is required');
  }

  console.log(`📍 Company ID: ${companyId}`);
  console.log(`📦 Cards to seed: ${HVAC_STARTER_CARDS.length}`);
  console.log(`🔘 Auto-activate: ${activate}`);
  console.log(`🧪 Dry run: ${dryRun}\n`);

  const results = {
    created: [],
    skipped: [],
    errors: []
  };

  for (const cardData of HVAC_STARTER_CARDS) {
    try {
      // Check if card already exists
      const existing = await TriageCard.findOne({
        companyId,
        triageLabel: cardData.triageLabel
      });

      if (existing) {
        console.log(`⏭️  Skipped: ${cardData.displayName} (already exists)`);
        results.skipped.push(cardData.triageLabel);
        continue;
      }

      if (dryRun) {
        console.log(`🧪 Would create: ${cardData.displayName}`);
        results.created.push(cardData.triageLabel);
        continue;
      }

      // Create the card
      const card = await TriageCard.create({
        companyId,
        trade: 'HVAC',
        isActive: activate,
        ...cardData
      });

      console.log(`✅ Created: ${card.displayName} (${card.triageLabel})`);
      results.created.push(cardData.triageLabel);

    } catch (err) {
      console.error(`❌ Error creating ${cardData.triageLabel}: ${err.message}`);
      results.errors.push({ triageLabel: cardData.triageLabel, error: err.message });
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SEED RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Created: ${results.created.length}`);
  console.log(`⏭️  Skipped: ${results.skipped.length}`);
  console.log(`❌ Errors: ${results.errors.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const companyId = process.argv[2];
  const activate = process.argv.includes('--activate');
  const dryRun = process.argv.includes('--dry-run');

  if (!companyId) {
    console.log('Usage: node seeds/hvacTriageStarterPack.js <companyId> [--activate] [--dry-run]');
    console.log('\nOptions:');
    console.log('  --activate  Activate cards immediately (default: inactive)');
    console.log('  --dry-run   Preview what would be created without writing');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    await seedHVACStarterPack(companyId, { activate, dryRun });

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = {
  HVAC_STARTER_CARDS,
  seedHVACStarterPack
};

// Run if called directly
if (require.main === module) {
  main();
}

