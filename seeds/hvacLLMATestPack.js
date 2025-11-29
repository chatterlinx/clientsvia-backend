// seeds/hvacLLMATestPack.js
// V23 LLM-A Test Data - HVAC Triage Card Generation
// 
// PURPOSE: Test inputs for /api/admin/triage-builder/generate-card-v23
// 
// Usage:
//   1. Copy the triageIdea payloads below
//   2. POST to /api/admin/triage-builder/generate-card-v23
//   3. Review output, validate with stress test utterances
//   4. If good, save via /api/admin/triage-builder/save-draft-v23
//
// ═══════════════════════════════════════════════════════════════════════════

// Company context (use for all 4 lanes)
const COMPANY_CONTEXT = {
  companyId: '68e3f77a9d623b8058c700c4', // Royal HVAC
  companyName: 'Royal HVAC Services',
  tradeKey: 'HVAC',
  regionProfile: {
    climate: 'HOT_ONLY',  // Florida - cooling focused
    supportsHeating: false,
    supportsCooling: true,
    supportsMaintenance: true,
    supportsEmergency: true
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LANE 1: AC MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════

const AC_MAINTENANCE_INPUT = {
  ...COMPANY_CONTEXT,
  triageIdea: {
    adminTitle: 'AC Maintenance / Tune-Up',
    desiredAction: 'DIRECT_TO_3TIER',
    intentHint: 'AC_MAINTENANCE',
    serviceTypeHint: 'MAINTENANCE',
    threeTierHint: {
      categoryKey: 'HVAC_MAINTENANCE',
      scenarioKey: 'AC_TUNEUP_STANDARD'
    },
    exampleUtterances: [
      "I want to schedule my AC tune-up",
      "I need annual AC maintenance",
      "Can I book a yearly AC service?",
      "I'd like to get my air conditioner checked before summer",
      "Do you do AC cleanings?",
      "I want to schedule preventive maintenance on my AC"
    ]
  }
};

// Stress test utterances for AC MAINTENANCE
const AC_MAINTENANCE_STRESS_TEST = {
  positiveUtterances: [
    // Standard variations
    "I want to schedule my AC tune-up",
    "I need annual AC maintenance",
    "Can I book a yearly AC service?",
    "I'd like to get my air conditioner checked before summer",
    "Do you do AC cleanings?",
    "I want to schedule preventive maintenance on my AC",
    // Slang / casual
    "Need to get my AC looked at, just a checkup",
    "Can someone come tune up my AC?",
    "Yeah I just need an AC tuneup",
    "Looking to schedule maintenance for my air conditioner",
    // Specific requests
    "I want the $89 AC tune-up special",
    "Can I get my AC serviced before the heat wave?",
    "Annual service on my central air",
    "My AC needs its yearly maintenance",
    "Time for my AC's annual checkup",
    // Misspellings / broken English
    "I need AC maintainance please",
    "Can you come check my AC system?",
    "I want tune up for air conditioning",
    "AC service, the maintenance one",
    "Schedule tuneup for air conditioner"
  ],
  negativeUtterances: [
    // Repair issues (should NOT match maintenance)
    "My AC is not cooling",
    "The AC stopped working",
    "AC is blowing warm air",
    "There's water leaking from my AC",
    "My AC makes a loud noise",
    "The air conditioner won't turn on",
    // New system (should NOT match maintenance)
    "I need a quote for a new AC",
    "How much for a new air conditioner?",
    "I want to replace my AC unit",
    "Looking for an estimate on new AC installation",
    // Emergency (should NOT match maintenance)
    "This is an emergency, my AC is smoking",
    "Urgent - burning smell from AC",
    // Other services
    "I need electrical work done",
    "Can you fix my plumbing?",
    "I have a billing question"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// LANE 2: AC REPAIR
// ═══════════════════════════════════════════════════════════════════════════

const AC_REPAIR_INPUT = {
  ...COMPANY_CONTEXT,
  triageIdea: {
    adminTitle: 'AC Repair / Not Cooling',
    desiredAction: 'DIRECT_TO_3TIER',
    intentHint: 'AC_REPAIR',
    serviceTypeHint: 'REPAIR',
    threeTierHint: {
      categoryKey: 'HVAC_REPAIR',
      scenarioKey: 'AC_NOT_COOLING'
    },
    exampleUtterances: [
      "My AC is not cooling",
      "The air conditioner stopped working",
      "AC is running but blowing warm air",
      "My AC won't turn on",
      "The AC isn't working right",
      "Something's wrong with my air conditioner"
    ]
  }
};

// Stress test utterances for AC REPAIR
const AC_REPAIR_STRESS_TEST = {
  positiveUtterances: [
    // Standard variations
    "My AC is not cooling",
    "The air conditioner stopped working",
    "AC is running but blowing warm air",
    "My AC won't turn on",
    "The AC isn't working right",
    "Something's wrong with my air conditioner",
    // Specific symptoms
    "My AC is only blowing warm air",
    "The AC runs but the house won't cool down",
    "Air conditioner making weird noise and not cooling",
    "AC unit outside isn't running",
    "My thermostat says cooling but nothing happens",
    "The compressor won't kick on",
    // Casual / slang
    "AC is busted",
    "My air isn't cold anymore",
    "Yeah the AC just quit on me",
    "AC crapped out last night",
    "Something broke on my AC",
    // Urgent but not emergency
    "AC stopped cooling today, it's really hot",
    "Need someone to look at my broken AC",
    "AC hasn't worked for two days",
    // Broken English
    "AC no work",
    "Air conditioning not cold",
    "My AC it don't cool no more"
  ],
  negativeUtterances: [
    // Maintenance (should NOT match repair)
    "I want to schedule my AC tune-up",
    "Need annual maintenance on my AC",
    "Can I book a cleaning for my AC?",
    // New system
    "I need a new AC unit installed",
    "How much for a brand new air conditioner?",
    "I want to replace my whole system",
    // Emergency (should escalate, not repair)
    "I smell gas near my AC",
    "There's smoke coming from the AC unit",
    "Burning smell - is this dangerous?",
    // Other
    "I need help with my furnace",
    "What time do you open?",
    "I have a billing issue"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// LANE 3: NEW SYSTEM ESTIMATE
// ═══════════════════════════════════════════════════════════════════════════

const NEW_SYSTEM_INPUT = {
  ...COMPANY_CONTEXT,
  triageIdea: {
    adminTitle: 'New AC System / Quote',
    desiredAction: 'DIRECT_TO_3TIER',
    intentHint: 'NEW_SYSTEM_ESTIMATE',
    serviceTypeHint: 'OTHER',
    threeTierHint: {
      categoryKey: 'HVAC_SALES',
      scenarioKey: 'NEW_AC_ESTIMATE'
    },
    exampleUtterances: [
      "I need a quote for a new AC",
      "How much for a new air conditioner?",
      "I want to replace my AC unit",
      "Looking for an estimate on AC installation",
      "What would it cost to get a new system?",
      "I'm interested in a new AC"
    ]
  }
};

// Stress test utterances for NEW SYSTEM
const NEW_SYSTEM_STRESS_TEST = {
  positiveUtterances: [
    // Standard variations
    "I need a quote for a new AC",
    "How much for a new air conditioner?",
    "I want to replace my AC unit",
    "Looking for an estimate on AC installation",
    "What would it cost to get a new system?",
    "I'm interested in a new AC",
    // Specific requests
    "I need a new central air system",
    "Can I get pricing on AC replacement?",
    "My AC is 20 years old, time for a new one",
    "I want to upgrade my air conditioning",
    "Looking to install AC in my new house",
    "Need a quote for a complete AC replacement",
    // Casual
    "What's it run for a new AC these days?",
    "I'm thinking about getting a new unit",
    "Ready to pull the trigger on a new AC",
    "Shopping around for AC prices",
    // Questions about options
    "What brands do you carry?",
    "Do you sell those mini split things?",
    "What's the difference between your AC options?",
    // Broken English
    "I want buy new AC",
    "New air condition how much?",
    "Price for new AC unit please"
  ],
  negativeUtterances: [
    // Repair (should NOT match new system)
    "My AC is broken, can you fix it?",
    "The AC isn't cooling",
    "Something's wrong with my current AC",
    // Maintenance
    "I just need a tune-up",
    "Annual maintenance on my AC",
    // Emergency
    "This is an emergency",
    "Smoke coming from AC",
    // Other
    "I need duct cleaning",
    "Can you check my thermostat?",
    "What are your hours?"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// LANE 4: AC EMERGENCY
// ═══════════════════════════════════════════════════════════════════════════

const AC_EMERGENCY_INPUT = {
  ...COMPANY_CONTEXT,
  triageIdea: {
    adminTitle: 'AC Emergency / Urgent',
    desiredAction: 'ESCALATE_TO_HUMAN',
    intentHint: 'AC_EMERGENCY',
    serviceTypeHint: 'EMERGENCY',
    threeTierHint: {
      categoryKey: 'EMERGENCY',
      scenarioKey: 'AC_EMERGENCY_DISPATCH'
    },
    exampleUtterances: [
      "This is an emergency, my AC is smoking",
      "I smell something burning from my AC",
      "There's smoke coming from the air conditioner",
      "My AC is making sparks",
      "I think my AC is on fire",
      "Urgent - elderly person, no AC, 100 degrees"
    ]
  }
};

// Stress test utterances for AC EMERGENCY
const AC_EMERGENCY_STRESS_TEST = {
  positiveUtterances: [
    // Standard variations
    "This is an emergency, my AC is smoking",
    "I smell something burning from my AC",
    "There's smoke coming from the air conditioner",
    "My AC is making sparks",
    "I think my AC is on fire",
    "Urgent - elderly person, no AC, 100 degrees",
    // Safety concerns
    "Burning smell from the AC unit",
    "There's a fire smell near my air conditioner",
    "Smoke coming from the outdoor unit",
    "I see sparks flying from my AC",
    "Something is melting in my AC",
    // Health emergencies
    "My grandmother has no AC and it's an emergency",
    "Baby in the house, AC dead, very hot",
    "Medical emergency - need AC fixed NOW",
    "Urgent - AC out, sick family member",
    // Panic / urgent language
    "Help! My AC is smoking!",
    "Emergency emergency - AC problem",
    "I need someone RIGHT NOW",
    "This can't wait - AC crisis",
    "Urgent help needed - AC",
    // Broken English
    "AC smoke! Emergency!",
    "Fire smell AC help!",
    "AC burn smell urgent!"
  ],
  negativeUtterances: [
    // Regular repair (NOT emergency)
    "My AC stopped working yesterday",
    "AC not cooling, but no rush",
    "Can someone come look at my AC this week?",
    // Maintenance
    "Schedule my annual tune-up",
    "I need AC maintenance",
    // New system
    "Looking for a quote on new AC",
    "How much for replacement?",
    // Casual complaints
    "AC isn't working great",
    "House is a bit warm",
    "AC takes a while to cool down"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE TEST PACK (export for use in tests/scripts)
// ═══════════════════════════════════════════════════════════════════════════

const HVAC_LLM_A_TEST_PACK = {
  companyContext: COMPANY_CONTEXT,
  
  lanes: {
    AC_MAINTENANCE: {
      input: AC_MAINTENANCE_INPUT,
      stressTest: AC_MAINTENANCE_STRESS_TEST
    },
    AC_REPAIR: {
      input: AC_REPAIR_INPUT,
      stressTest: AC_REPAIR_STRESS_TEST
    },
    NEW_SYSTEM: {
      input: NEW_SYSTEM_INPUT,
      stressTest: NEW_SYSTEM_STRESS_TEST
    },
    AC_EMERGENCY: {
      input: AC_EMERGENCY_INPUT,
      stressTest: AC_EMERGENCY_STRESS_TEST
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CLI TEST RUNNER (optional)
// ═══════════════════════════════════════════════════════════════════════════

async function runLLMATest(laneName) {
  const lane = HVAC_LLM_A_TEST_PACK.lanes[laneName];
  if (!lane) {
    console.error(`Unknown lane: ${laneName}`);
    console.log('Available lanes:', Object.keys(HVAC_LLM_A_TEST_PACK.lanes).join(', '));
    return;
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🚀 LLM-A TEST: ${laneName}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('📤 INPUT PAYLOAD:\n');
  console.log(JSON.stringify(lane.input, null, 2));
  
  console.log('\n\n📋 STRESS TEST UTTERANCES:');
  console.log(`   Positives: ${lane.stressTest.positiveUtterances.length}`);
  console.log(`   Negatives: ${lane.stressTest.negativeUtterances.length}`);
  
  console.log('\n\n📝 CURL COMMAND:\n');
  console.log(`curl -X POST http://localhost:10000/api/admin/triage-builder/generate-card-v23 \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '${JSON.stringify(lane.input)}'`);
  
  console.log('\n');
}

// Main
if (require.main === module) {
  const laneName = process.argv[2];
  
  if (!laneName) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🔥 HVAC LLM-A TEST PACK');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Usage: node seeds/hvacLLMATestPack.js <LANE_NAME>\n');
    console.log('Available lanes:');
    Object.keys(HVAC_LLM_A_TEST_PACK.lanes).forEach(name => {
      console.log(`  - ${name}`);
    });
    console.log('\nExample: node seeds/hvacLLMATestPack.js AC_MAINTENANCE\n');
    
    console.log('Or use in code:');
    console.log('  const { HVAC_LLM_A_TEST_PACK } = require("./seeds/hvacLLMATestPack");');
    console.log('  const input = HVAC_LLM_A_TEST_PACK.lanes.AC_MAINTENANCE.input;');
    console.log('');
  } else {
    runLLMATest(laneName);
  }
}

module.exports = {
  COMPANY_CONTEXT,
  AC_MAINTENANCE_INPUT,
  AC_MAINTENANCE_STRESS_TEST,
  AC_REPAIR_INPUT,
  AC_REPAIR_STRESS_TEST,
  NEW_SYSTEM_INPUT,
  NEW_SYSTEM_STRESS_TEST,
  AC_EMERGENCY_INPUT,
  AC_EMERGENCY_STRESS_TEST,
  HVAC_LLM_A_TEST_PACK
};

